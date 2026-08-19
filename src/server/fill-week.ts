import type { Shift, WorkDay } from "@/lib/work-days";

export interface BaseScheduleEntry {
  boardRowId: string;
  employeeId: string;
  shift: Shift;
  validFrom: string | null;
  validTo: string | null;
  sortOrder: number;
}

export interface ExistingAssignment {
  id: string;
  boardRowId: string;
  date: string;
  shift: Shift;
  slot: number;
  employeeId: string | null;
  source: "generated" | "manual";
}

export interface AbsenceRange {
  employeeId: string;
  fromDate: string;
  toDate: string;
}

export interface PlannedAssignment {
  boardRowId: string;
  date: string;
  shift: Shift;
  slot: number;
  employeeId: string;
}

export interface WeekPlan {
  create: PlannedAssignment[];
  /** Automatgenererade pass som inte längre hör hemma. */
  deleteIds: string[];
  /** Jobbar men har ingen bil — listan som ska bli tom när veckan är klar. */
  unplaced: Array<{ employeeId: string; date: string; shift: Shift }>;
}

const covers = (e: BaseScheduleEntry, date: string) =>
  (!e.validFrom || date >= e.validFrom) && (!e.validTo || date <= e.validTo);

/**
 * Räknar ut veckans pass ur arbetsdagar och bas-schema.
 *
 * Bas-schemat säger *vilken bil* en person hör till, aldrig vilka dagar.
 * Dagarna kommer från arbetsdagarna. Det är därför BT13/14 bemannas av
 * Björn måndag, tisdag, torsdag, fredag och av Roger onsdag utan att
 * någon skrivit in det per dag — båda är kopplade till bilen, och deras
 * arbetsdagar avgör resten.
 *
 * Handpålagda pass rörs aldrig. Bara automatgenererade skrivs om, så
 * knappen går att trycka på igen när TransPA-schemat ändrats utan att
 * planerarens justeringar försvinner.
 */
export function planWeek(input: {
  workDays: WorkDay[];
  baseSchedule: BaseScheduleEntry[];
  existing: ExistingAssignment[];
  absences?: AbsenceRange[];
  dates: string[];
}): WeekPlan {
  const inWeek = new Set(input.dates);
  const manual = input.existing.filter((a) => a.source === "manual");
  const generated = input.existing.filter((a) => a.source === "generated");

  /* En person som redan lagts ut för hand en viss dag och skift ska
     inte få ett andra pass av genereringen. */
  const placedManually = new Set(
    manual
      .filter((a) => a.employeeId)
      .map((a) => `${a.employeeId}|${a.date}|${a.shift}`),
  );

  /* Upptagna slots per cell. Handpålagda behåller sin plats. */
  const usedSlots = new Map<string, Set<number>>();
  const cellKey = (boardRowId: string, date: string, shift: Shift) =>
    `${boardRowId}|${date}|${shift}`;
  for (const a of manual) {
    const key = cellKey(a.boardRowId, a.date, a.shift);
    usedSlots.set(key, (usedSlots.get(key) ?? new Set()).add(a.slot));
  }
  const takeSlot = (key: string): number => {
    const used = usedSlots.get(key) ?? new Set<number>();
    let slot = 0;
    while (used.has(slot)) slot++;
    used.add(slot);
    usedSlots.set(key, used);
    return slot;
  };

  const create: PlannedAssignment[] = [];
  const unplaced: WeekPlan["unplaced"] = [];

  const workDays = [...input.workDays]
    .filter((w) => inWeek.has(w.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));

  for (const wd of workDays) {
    if (placedManually.has(`${wd.employeeId}|${wd.date}|${wd.shift}`)) continue;

    /* Den som är ledig bemannas inte, och räknas inte heller som ej
       utlagd — annars skulle semester se ut som en lucka att fylla. */
    const away = (input.absences ?? []).some(
      (a) => a.employeeId === wd.employeeId && wd.date >= a.fromDate && wd.date <= a.toDate,
    );
    if (away) continue;

    const rows = input.baseSchedule
      .filter((e) => e.employeeId === wd.employeeId && e.shift === wd.shift && covers(e, wd.date))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (rows.length === 0) {
      unplaced.push({ employeeId: wd.employeeId, date: wd.date, shift: wd.shift });
      continue;
    }

    const target = rows[0];
    const key = cellKey(target.boardRowId, wd.date, wd.shift);
    create.push({
      boardRowId: target.boardRowId,
      date: wd.date,
      shift: wd.shift,
      slot: takeSlot(key),
      employeeId: wd.employeeId,
    });
  }

  return {
    create,
    deleteIds: generated.filter((a) => inWeek.has(a.date)).map((a) => a.id),
    unplaced,
  };
}
