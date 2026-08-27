/**
 * Konfliktdetektering.
 *
 * Körs mot alla tilldelningar för de aktuella datumen, inte bara den
 * tavla man tittar på — en förare som bokats på både fjärr- och
 * lotstavlan samma dag ska hittas.
 */

import type { Shift } from "./work-days";

export interface AssignmentLike {
  id: string;
  boardRowId: string;
  date: string;
  shift: Shift;
  slot: number;
  employeeId: string | null;
  vehicleId: string | null;
  /** Vilken tavla tilldelningen sitter på — används för att förklara krocken. */
  boardId: string;
  boardName: string;
  rowLabel: string;
}

export interface AbsenceLike {
  employeeId: string;
  fromDate: string;
  toDate: string;
  type: string;
}

export interface RowLike {
  id: string;
  validFrom: string | null;
  validTo: string | null;
}

export type Conflict =
  | {
      kind: "double-booked";
      date: string;
      employeeId: string;
      assignmentIds: string[];
      /** Var personen står, för att planeraren ska kunna avgöra. */
      places: string[];
    }
  | {
      kind: "absent";
      date: string;
      employeeId: string;
      assignmentId: string;
      absenceType: string;
    }
  | { kind: "vehicle-clash"; date: string; vehicleId: string; assignmentIds: string[]; places: string[] }
  /** Samma person på både dag- och nattpass samma dygn. Mildare. */
  | { kind: "day-and-night"; date: string; employeeId: string; assignmentIds: string[] }
  /**
   * Personen står på ett skift men är planerad på det andra i TransPA.
   *
   * Den vanligaste feltypen när ett schema förs över för hand: någon
   * läggs på dagraden fast hen kör natt. TransPA vet vilket, och det är
   * värt att säga ifrån innan veckan delas ut.
   */
  | {
      kind: "shift-mismatch";
      date: string;
      employeeId: string;
      assignmentId: string;
      /** Skiftet personen står på hos oss. */
      placed: Shift;
      /** Skiftet TransPA har planerat. */
      planned: Shift;
    }
  | { kind: "unmanned"; date: string; boardRowId: string; shift: Shift };

export function isRowActive(row: RowLike, date: string): boolean {
  if (row.validFrom && date < row.validFrom) return false;
  if (row.validTo && date > row.validTo) return false;
  return true;
}

export function coversDate(a: AbsenceLike, date: string): boolean {
  return date >= a.fromDate && date <= a.toDate;
}

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

/**
 * Krockar mellan bokningar: samma förare eller samma bil på två håll,
 * och förare som står inplanerade under sin frånvaro.
 *
 * Tar emot tilldelningar från *alla* tavlor för de aktuella datumen —
 * en förare som bokats på både fjärr- och lotstavlan ska hittas.
 */
export function detectBookingConflicts(input: {
  assignments: AssignmentLike[];
  absences: AbsenceLike[];
  dates: string[];
}): Conflict[] {
  const conflicts: Conflict[] = [];
  const place = (a: AssignmentLike) => `${a.boardName}: ${a.rowLabel}`;

  for (const date of input.dates) {
    const onDate = input.assignments.filter((a) => a.date === date);

    for (const [employeeId, all] of groupBy(onDate, (a) => a.employeeId)) {
      // Två pass samma skift är en verklig krock — personen kan inte
      // vara på två håll. Ett dagpass och ett nattpass samma dygn är
      // möjligt men värt en mildare varning.
      for (const shift of ["day", "night"] as const) {
        const list = all.filter((a) => a.shift === shift);
        if (list.length > 1) {
          conflicts.push({
            kind: "double-booked",
            date,
            employeeId,
            assignmentIds: list.map((a) => a.id),
            places: [...new Set(list.map(place))],
          });
        }
      }
      const shifts = new Set(all.map((a) => a.shift));
      if (shifts.size > 1) {
        conflicts.push({
          kind: "day-and-night",
          date,
          employeeId,
          assignmentIds: all.map((a) => a.id),
        });
      }
    }

    for (const [vehicleId, all] of groupBy(onDate, (a) => a.vehicleId)) {
      // Samma bil dag och natt är själva poängen med skiften, och två
      // förare som delar en tur kör samma bil. Bara samma bil på fler
      // än en rad inom samma skift är en krock.
      for (const shift of ["day", "night"] as const) {
        const list = all.filter((a) => a.shift === shift);
        const distinctRows = new Set(list.map((a) => a.boardRowId));
        if (distinctRows.size > 1) {
          conflicts.push({
            kind: "vehicle-clash",
            date,
            vehicleId,
            assignmentIds: list.map((a) => a.id),
            places: [...new Set(list.map(place))],
          });
        }
      }
    }

    for (const a of onDate) {
      if (!a.employeeId) continue;
      const hit = input.absences.find((x) => x.employeeId === a.employeeId && coversDate(x, date));
      if (hit) {
        conflicts.push({
          kind: "absent",
          date,
          employeeId: a.employeeId,
          assignmentId: a.id,
          absenceType: hit.type,
        });
      }
    }

  }

  return conflicts;
}

/**
 * Obemannade pass.
 *
 * Räknas per tavla: bara de datum tavlan faktiskt visar och bara rader
 * som gäller då. Utan den avgränsningen larmar varje rad för varje
 * lördag och för varje vecka den inte används, och varningen blir
 * meningslös.
 */
export function detectUnmanned(
  boards: Array<{
    rows: RowLike[];
    dates: string[];
    shifts: Shift[];
    assignments: AssignmentLike[];
  }>,
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const board of boards) {
    const manned = new Set(board.assignments.map((a) => `${a.boardRowId}|${a.date}|${a.shift}`));
    for (const date of board.dates) {
      for (const row of board.rows) {
        if (!isRowActive(row, date)) continue;
        for (const shift of board.shifts) {
          if (!manned.has(`${row.id}|${date}|${shift}`)) {
            conflicts.push({ kind: "unmanned", date, boardRowId: row.id, shift });
          }
        }
      }
    }
  }
  return conflicts;
}

/**
 * Personer som står på fel skift.
 *
 * Jämför var någon är utlagd mot vad TransPA planerat samma dag. Bara
 * dagar källan faktiskt har besked om räknas — saknas passet vet vi
 * ingenting, och tystnad är inget fel.
 */
export function detectShiftMismatch(input: {
  assignments: AssignmentLike[];
  /** Arbetsdagarna som källan gav dem, med skift. */
  workDays: Array<{ employeeId: string; date: string; shift: Shift }>;
}): Conflict[] {
  /* Personens skift den dagen enligt källan. Har hen både dag och natt
     är ingendera fel, och dagen hoppas över. */
  const planned = new Map<string, Set<Shift>>();
  for (const day of input.workDays) {
    const key = `${day.employeeId}|${day.date}`;
    planned.set(key, (planned.get(key) ?? new Set()).add(day.shift));
  }

  const out: Conflict[] = [];
  for (const a of input.assignments) {
    if (!a.employeeId) continue;
    const shifts = planned.get(`${a.employeeId}|${a.date}`);
    if (!shifts || shifts.size !== 1) continue;

    const [only] = shifts;
    if (only !== a.shift) {
      out.push({
        kind: "shift-mismatch",
        date: a.date,
        employeeId: a.employeeId,
        assignmentId: a.id,
        placed: a.shift,
        planned: only,
      });
    }
  }
  return out;
}

export interface ConflictIndex {
  /** Konflikter som hör till en enskild tilldelning. */
  byAssignment: Map<string, Conflict[]>;
  /** Konflikter som hör till en tom cell, nyckel `radId|datum|skift`. */
  byCell: Map<string, Conflict[]>;
}

/** Sorterar konflikterna så rutnätet kan slå upp dem per ruta. */
export function indexConflicts(conflicts: Conflict[]): ConflictIndex {
  const byAssignment = new Map<string, Conflict[]>();
  const byCell = new Map<string, Conflict[]>();
  const add = (map: Map<string, Conflict[]>, key: string, c: Conflict) => {
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  };

  for (const c of conflicts) {
    switch (c.kind) {
      case "unmanned":
        add(byCell, `${c.boardRowId}|${c.date}|${c.shift}`, c);
        break;
      case "absent":
      case "shift-mismatch":
        add(byAssignment, c.assignmentId, c);
        break;
      case "double-booked":
      case "vehicle-clash":
      case "day-and-night":
        for (const id of c.assignmentIds) add(byAssignment, id, c);
        break;
    }
  }
  return { byAssignment, byCell };
}
