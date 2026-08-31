import type { TranspaShift, TranspaShiftPart } from "./shifts";

/**
 * Att flytta ett pass till en annan dag.
 *
 * TransPA:s PUT /v1/shifts/{id} ersätter passet, så kroppen måste bära
 * hela passet och inte bara det som ändrats. Ett fält som glöms bort
 * försvinner ur passet.
 *
 * Flytten är rent en förskjutning i tid: klockslagen och passets längd
 * står orörda, bara datumet byts. Ett nattpass 19:00–04:00 flyttat en
 * dag framåt är fortfarande 19:00–04:00, och slutet ligger fortfarande
 * dagen efter starten. Därför skjuts alla tidpunkter lika mycket i
 * stället för att sättas var för sig — annars skulle
 * övermidnattspassen tappa sitt dygnsbyte.
 */

const DAY_MS = 86_400_000;

export interface ShiftMove {
  /** Passets id hos TransPA. */
  transpaId: string;
  /** Dagen passet ligger på idag, som verktyget räknar den. */
  from: string;
  /** Dagen det ska flyttas till. */
  to: string;
}

/** Hur många hela dygn flytten är. */
export function shiftDays(move: { from: string; to: string }): number {
  const a = new Date(`${move.from}T00:00:00Z`).getTime();
  const b = new Date(`${move.to}T00:00:00Z`).getTime();
  return Math.round((b - a) / DAY_MS);
}

const flytta = (iso: string, dagar: number) =>
  new Date(new Date(iso).getTime() + dagar * DAY_MS).toISOString();

export class ShiftMoveError extends Error {}

/**
 * Kroppen till PUT /v1/shifts/{id} för en flytt.
 *
 * Kastar hellre än att skicka ett halvt pass: ett pass utan starttid
 * eller utan partsOfDay går inte att flytta utan att gissa, och en
 * gissning skriven till en produktionstenant är värre än ett fel här.
 */
export function buildMovePayload(shift: TranspaShift, dagar: number): Record<string, unknown> {
  if (!shift.startDateTime) throw new ShiftMoveError("Passet saknar starttid.");
  if (Number.isNaN(new Date(shift.startDateTime).getTime())) {
    throw new ShiftMoveError("Passets starttid går inte att tolka.");
  }
  if (!shift.partsOfDay?.length) {
    throw new ShiftMoveError(
      "Passet saknar partsOfDay. Sluttiden går inte att flytta utan att gissa den.",
    );
  }

  const delar: TranspaShiftPart[] = shift.partsOfDay.map((del) => {
    if (!del.endDateTime || Number.isNaN(new Date(del.endDateTime).getTime())) {
      throw new ShiftMoveError("En del av passet saknar sluttid.");
    }
    return { ...del, endDateTime: flytta(del.endDateTime, dagar) };
  });

  /* Allt som fanns skickas tillbaka. PUT ersätter passet, så ett fält
     som utelämnas är ett fält som raderas. */
  return {
    id: shift.id,
    employeeId: shift.employeeId,
    startDateTime: flytta(shift.startDateTime, dagar),
    partsOfDay: delar,
    breaks: shift.breaks ?? [],
    adjustedWorkTimeInMinutes: shift.adjustedWorkTimeInMinutes,
    isExtraShift: shift.isExtraShift ?? false,
    ...(shift.name != null ? { name: shift.name } : {}),
    ...(shift.description != null ? { description: shift.description } : {}),
    ...(shift.externalId != null ? { externalId: shift.externalId } : {}),
  };
}
