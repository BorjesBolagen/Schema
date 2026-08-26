import { isoMonday, weekdayOf } from "./week";
import type { Shift } from "./work-days";

/**
 * Arbetsmönster föreslagna ur turhistoriken.
 *
 * Bakgrund: TransPA:s Public API levererar inga planerade pass — varje
 * väg till shifts, scheman, frånvaro och semester svarar 404, även med
 * ett riktigt person-id (kontrollerat mot Börjes tenant 2026-08-26).
 * Det enda som säger något om när en person är i tjänst är /v1/trips,
 * och där ligger bara turer bakåt i tiden. Historik alltså, inte plan.
 *
 * Historik kan ändå spara det mesta av handpåläggningen: kör någon
 * måndag till fredag varje vecka syns det direkt, och då ska ingen
 * behöva kryssa i det för hand. Modulen läser turerna och föreslår —
 * den bestämmer inte. Osäkra dagar lämnas åt planeraren i stället för
 * att gissas åt hen, eftersom ett tyst felaktigt mönster är värre än
 * ett tomt.
 */

export interface TripLike {
  employeeId: string;
  /** ISO-tidpunkt, i UTC som TransPA skickar den. */
  startDateTime: string;
}

/** Underlaget bakom en föreslagen dag — eller bakom att den inte föreslås. */
export interface DayEvidence {
  /** 0 = söndag … 6 = lördag */
  weekday: number;
  shift: Shift;
  /** Veckor personen körde den här dagen och skiftet. */
  weeksWorked: number;
  /** Veckor personen körde över huvud taget. */
  weeksObserved: number;
  /** weeksWorked / weeksObserved, 0–1. */
  share: number;
}

export interface PatternSuggestion {
  employeeId: string;
  weeksObserved: number;
  /** Dagar som är säkra nog att fylla i åt planeraren. */
  days: Array<{ weekday: number; shift: Shift }>;
  /** Dagar som förekommer, men för oregelbundet för att föreslås. */
  uncertain: DayEvidence[];
  evidence: DayEvidence[];
  confidence: "hög" | "låg" | "otillräcklig";
}

export interface SuggestOptions {
  /** Andel veckor en dag måste förekomma för att föreslås. */
  threshold?: number;
  /** Under så här många observerade veckor är förslaget inte att lita på. */
  minWeeks?: number;
  timeZone?: string;
}

/**
 * Turerna kommer i UTC, men vilken veckodag och vilket skift en tur
 * hör till avgörs av svensk lokaltid. En tur som startar 23:30 svensk
 * tid en söndag i juli är 21:30Z — fel dag och fel skift om man läser
 * UTC rakt av.
 */
const STOCKHOLM = "Europe/Stockholm";

export function localParts(iso: string, timeZone = STOCKHOLM): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // hourCycle h23 ger "24" för midnatt i vissa körningar; normalisera.
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

/**
 * Dag eller natt, utifrån när turen startar.
 *
 * Gränsen är satt så att en tur som rullar ut på kvällen räknas som
 * natt även när den startar före midnatt — det är så ett nattpass ser
 * ut i praktiken. Heuristik, inte sanning: den finns för att förslaget
 * ska bli användbart, och planeraren kan ändra.
 */
export function shiftOfHour(hour: number): Shift {
  return hour >= 18 || hour < 5 ? "night" : "day";
}

const key = (weekday: number, shift: Shift) => `${weekday}|${shift}`;

export function suggestPatterns(
  trips: TripLike[],
  options: SuggestOptions = {},
): PatternSuggestion[] {
  const { threshold = 0.8, minWeeks = 3, timeZone = STOCKHOLM } = options;

  /* Per person: vilka veckor hen körde alls, och vilka veckor varje
     kombination av veckodag och skift förekom. Veckor räknas som
     mängder eftersom två turer samma dag inte är två veckors bevis. */
  const weeksByEmployee = new Map<string, Set<string>>();
  const weeksByDay = new Map<string, Map<string, Set<string>>>();

  for (const trip of trips) {
    if (!trip.employeeId || !trip.startDateTime) continue;
    const { date, hour } = localParts(trip.startDateTime, timeZone);
    if (Number.isNaN(new Date(trip.startDateTime).getTime())) continue;

    const week = isoMonday(date);
    const shift = shiftOfHour(hour);
    const weekday = weekdayOf(date);

    if (!weeksByEmployee.has(trip.employeeId)) weeksByEmployee.set(trip.employeeId, new Set());
    weeksByEmployee.get(trip.employeeId)!.add(week);

    if (!weeksByDay.has(trip.employeeId)) weeksByDay.set(trip.employeeId, new Map());
    const days = weeksByDay.get(trip.employeeId)!;
    const k = key(weekday, shift);
    if (!days.has(k)) days.set(k, new Set());
    days.get(k)!.add(week);
  }

  const out: PatternSuggestion[] = [];

  for (const [employeeId, weeks] of weeksByEmployee) {
    const weeksObserved = weeks.size;
    const days = weeksByDay.get(employeeId) ?? new Map();

    const evidence: DayEvidence[] = [...days.entries()]
      .map(([k, seen]) => {
        const [weekday, shift] = k.split("|");
        return {
          weekday: Number(weekday),
          shift: shift as Shift,
          weeksWorked: seen.size,
          weeksObserved,
          share: seen.size / weeksObserved,
        };
      })
      .sort((a, b) => a.weekday - b.weekday || a.shift.localeCompare(b.shift));

    /* Under minWeeks är underlaget för tunt för att skilja ett mönster
       från en tillfällighet, och då föreslås ingenting alls — hellre
       tomt än fel. */
    const enough = weeksObserved >= minWeeks;
    const confident = evidence.filter((e) => e.share >= threshold);

    out.push({
      employeeId,
      weeksObserved,
      days: enough ? confident.map((e) => ({ weekday: e.weekday, shift: e.shift })) : [],
      uncertain: enough ? evidence.filter((e) => e.share < threshold) : evidence,
      evidence,
      confidence: !enough ? "otillräcklig" : confident.length > 0 ? "hög" : "låg",
    });
  }

  return out.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}
