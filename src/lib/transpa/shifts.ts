import { localParts, shiftOfHour } from "@/lib/trip-patterns";
import type { Shift, WorkDay } from "@/lib/work-days";

/**
 * Pass ur TransPA.
 *
 * Formen är bekräftad mot tenanten (2026-08-27), inte gissad:
 *
 *     GET /v1/shifts/?startDateTimeAfter=…&startDateTimeBefore=…
 *
 * Båda tidsgränserna är obligatoriska, och `startDateTimeBefore` måste
 * ligga efter `startDateTimeAfter` — annars svarar API:t 400. Utan dem
 * svarar vägen 404, vilket är precis varför den såg ut att inte finnas.
 *
 * Ett pass bär inget slutdatum. Längden ligger i
 * `adjustedWorkTimeInMinutes`, som enligt Vismas eget schema räknas
 * fram av resursen calculateAdjustedWorkTime.
 */

export interface TranspaShift {
  id?: string;
  employeeId?: string | null;
  /** ISO-tidpunkt i UTC. Obligatorisk enligt schemat. */
  startDateTime?: string;
  /** Passets längd i minuter, 1–1440. */
  adjustedWorkTimeInMinutes?: number;
  /** Pass utanför ordinarie arbetstid. */
  isExtraShift?: boolean;
  name?: string | null;
  description?: string | null;
  externalId?: string | null;
}

/** Sökvägen för hela bolagets pass i ett tidsfönster. */
export const SHIFTS_PATH = "/v1/shifts/";

/**
 * Tidsfönstret som frågeparametrar.
 *
 * `from` och `to` är datum (YYYY-MM-DD) som veckovyn räknar i. De
 * vidgas till hela dygn i svensk tid: ett pass som börjar 06:00 måndag
 * ligger 04:00Z på sommaren, och ett fönster som börjar vid midnatt UTC
 * skulle missa den sista timmen av söndagen i andra änden.
 */
export function shiftWindow(from: string, to: string): Record<string, string> {
  return {
    // En dags marginal i vardera riktningen kostar ingenting och gör
    // att inget pass faller utanför på grund av tidszonen.
    startDateTimeAfter: new Date(`${from}T00:00:00Z`).toISOString(),
    startDateTimeBefore: new Date(`${to}T23:59:59Z`).toISOString(),
  };
}

/**
 * Ett pass som en arbetsdag.
 *
 * Dagen och skiftet avgörs av svensk lokaltid, inte av UTC: ett pass
 * som startar 22:30Z en måndag i augusti är tisdag 00:30 här — fel dag
 * och fel skift om man läser tidpunkten rakt av.
 *
 * Null när passet saknar person eller starttid; ett pass utan dem säger
 * ingenting om vem som jobbar när.
 */
export function shiftToWorkDay(shift: TranspaShift, employeeId: string): WorkDay | null {
  if (!shift.startDateTime) return null;
  const when = new Date(shift.startDateTime);
  if (Number.isNaN(when.getTime())) return null;

  const { date, hour } = localParts(shift.startDateTime);
  return { employeeId, date, shift: shiftOfHour(hour) as Shift };
}

/**
 * Arbetsdagar ur en samling pass, utan dubbletter.
 *
 * Två pass samma dag och skift — ett delat pass, eller ett extrapass —
 * är fortfarande en arbetsdag. Dag och natt samma dygn är däremot två,
 * och tavlan visar dem på var sin rad.
 */
export function workDaysFromShifts(
  shifts: TranspaShift[],
  employeeIdFor: (transpaId: string) => string | undefined,
): { workDays: WorkDay[]; covered: string[] } {
  const seen = new Set<string>();
  const workDays: WorkDay[] = [];
  const covered = new Set<string>();

  for (const shift of shifts) {
    const localId = shift.employeeId ? employeeIdFor(shift.employeeId) : undefined;
    if (!localId) continue;

    const day = shiftToWorkDay(shift, localId);
    if (!day) continue;

    /* Personen räknas som täckt så snart TransPA sagt något om hen.
       Den som inte har ett enda pass lämnas otäckt och faller tillbaka
       på sitt lokala mönster — hellre det än att en tom vecka tolkas
       som ledighet och tömmer tavlan. */
    covered.add(localId);

    const key = `${day.employeeId}|${day.date}|${day.shift}`;
    if (seen.has(key)) continue;
    seen.add(key);
    workDays.push(day);
  }

  return { workDays, covered: [...covered] };
}
