import type { Shift } from "./work-days";

/**
 * Vad planeraren ändrat jämfört med TransPA.
 *
 * Tavlan säger var en person står; TransPA säger när hen jobbar. Flyttar
 * någon ett pass från onsdag till torsdag har tavlan en dag TransPA inte
 * har, och TransPA en dag tavlan inte har. Det paret är en flytt.
 *
 * Bara flyttar tolkas. En dag som bara finns på tavlan, utan en
 * motsvarande dag som försvunnit, är ett *nytt* pass — och att skapa ett
 * pass i TransPA är något annat än att flytta ett, med andra fält att
 * fylla i. Det lämnas därför utanför tills det efterfrågas, i stället
 * för att gissas fram som en flytt av fel pass.
 */

export interface PlacedDay {
  employeeId: string;
  date: string;
  shift: Shift;
}

export interface PlannedShift {
  employeeId: string;
  date: string;
  shift: Shift;
  /** Passets id hos TransPA — det som ska skrivas. */
  transpaId: string;
}

export interface ScheduleMove {
  employeeId: string;
  transpaId: string;
  shift: Shift;
  from: string;
  to: string;
}

export interface ScheduleDiff {
  moves: ScheduleMove[];
  /** Dagar på tavlan utan motsvarighet i TransPA, som inte är en flytt. */
  added: PlacedDay[];
  /** Pass i TransPA som ingen står på, och som inte är en flytt. */
  removed: PlannedShift[];
}

const key = (x: { employeeId: string; shift: Shift }) => `${x.employeeId}|${x.shift}`;

/**
 * Parar ihop borttagna och tillagda dagar till flyttar.
 *
 * Parningen sker per person och skift, och i datumordning: har någon
 * flyttat två pass samma vecka ska det tidigaste paras med det
 * tidigaste. Vilket som helst hade gett samma antal flyttar men fel
 * pass i varje — och det är passets id som skrivs.
 */
export function detectMoves(input: {
  placed: PlacedDay[];
  planned: PlannedShift[];
}): ScheduleDiff {
  const påTavlan = new Set(input.placed.map((p) => `${p.employeeId}|${p.date}|${p.shift}`));
  const iTranspa = new Set(input.planned.map((p) => `${p.employeeId}|${p.date}|${p.shift}`));

  const nya = input.placed.filter((p) => !iTranspa.has(`${p.employeeId}|${p.date}|${p.shift}`));
  const borta = input.planned.filter((p) => !påTavlan.has(`${p.employeeId}|${p.date}|${p.shift}`));

  const nyaPer = new Map<string, PlacedDay[]>();
  for (const n of [...nya].sort((a, b) => a.date.localeCompare(b.date))) {
    nyaPer.set(key(n), [...(nyaPer.get(key(n)) ?? []), n]);
  }

  const moves: ScheduleMove[] = [];
  const added: PlacedDay[] = [];
  const removed: PlannedShift[] = [];

  for (const b of [...borta].sort((a, b) => a.date.localeCompare(b.date))) {
    const kandidater = nyaPer.get(key(b));
    const mål = kandidater?.shift();
    if (mål) {
      moves.push({
        employeeId: b.employeeId,
        transpaId: b.transpaId,
        shift: b.shift,
        from: b.date,
        to: mål.date,
      });
    } else {
      removed.push(b);
    }
  }

  for (const kvar of nyaPer.values()) added.push(...kvar);

  return {
    moves,
    added: added.sort((a, b) => a.date.localeCompare(b.date)),
    removed,
  };
}
