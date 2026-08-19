import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  type AbsenceLike,
  type AssignmentLike,
  type Conflict,
  detectBookingConflicts,
  detectUnmanned,
  indexConflicts,
  isRowActive,
} from "@/lib/conflicts";
import { fullDisplayName } from "@/lib/name";
import type { Shift, WorkDay } from "@/lib/work-days";
import { weekDates } from "@/lib/week";
import { getWorkDayProvider } from "./work-days";

export interface CellAssignment {
  id: string;
  slot: number;
  employeeId: string | null;
  employeeName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  note: string | null;
  source: "generated" | "manual";
  conflicts: Conflict[];
}

export interface WeekRow {
  id: string;
  label: string;
  sublabel: string | null;
  color: string | null;
  groupId: string | null;
  groupLabel: string | null;
  validTo: string | null;
  defaultVehicleId: string | null;
  defaultVehicleName: string | null;
  /** Nyckel `datum|skift` → passen i cellen, sorterade på slot. */
  cells: Record<string, CellAssignment[]>;
  /** Datum där raden ligger utanför sitt giltighetsintervall. */
  inactiveDates: string[];
}

export interface CrewMember {
  employeeId: string;
  name: string;
  stationPlace: string | null;
  /** Dagarna personen jobbar den här veckan, från arbetsdagskällan. */
  workDays: Array<{ date: string; shift: Shift }>;
  /** Arbetsdagar som ännu inte lagts ut på någon bil. */
  unplaced: Array<{ date: string; shift: Shift }>;
  absence: { type: string; fromDate: string; toDate: string } | null;
}

export interface PersonDay {
  date: string;
  entries: Array<{ rowLabel: string; vehicleName: string | null; shift: Shift; note: string | null }>;
  absence: { type: string; note: string | null } | null;
  /** Jobbar enligt arbetsdagskällan men står inte på någon rad. */
  worksButUnplaced: boolean;
}

export interface BoardWeek {
  board: typeof schema.board.$inferSelect;
  year: number;
  week: number;
  dates: string[];
  shifts: Shift[];
  rows: WeekRow[];
  personRows: Array<{ employeeId: string; name: string; days: PersonDay[] }>;
  conflicts: Conflict[];
  crew: CrewMember[];
  /** Namnet på källan som gav arbetsdagarna, för att visa var de kommer ifrån. */
  workDaySource: string;

  /* Underlag för redigeringsvyerna. */
  groups: Array<{ id: string; label: string }>;
  vehicles: Array<{ id: string; name: string }>;
  baseSchedule: Array<{
    id: string;
    boardRowId: string;
    employeeId: string;
    shift: Shift;
    validFrom: string | null;
    validTo: string | null;
  }>;
  /** Arbetsmönstren för bemanningen, för mönsterredigeraren. */
  patterns: Array<{
    employeeId: string;
    cycleWeeks: number;
    anchorDate: string;
    weekStartsOn: number;
    days: Array<{ cycleWeek: number; weekday: number; shift: Shift }>;
  }>;
}

export async function getBoardBySlug(slug: string) {
  const db = getDb();
  const [board] = await db.select().from(schema.board).where(eq(schema.board.slug, slug));
  return board ?? null;
}

export async function listBoards() {
  const db = getDb();
  return db.select().from(schema.board).orderBy(asc(schema.board.sortOrder), asc(schema.board.name));
}

export async function getBoardWeek(
  slug: string,
  year: number,
  week: number,
): Promise<BoardWeek | null> {
  const db = getDb();
  const board = await getBoardBySlug(slug);
  if (!board) return null;

  const dates = weekDates(year, week, board.weekStartsOn, board.visibleWeekdays);
  const shifts = board.visibleShifts as Shift[];
  const first = dates[0];
  const last = dates[dates.length - 1];

  const [rows, groups, employees, vehicles, stations, crewRows, baseRows] = await Promise.all([
    db
      .select()
      .from(schema.boardRow)
      .where(eq(schema.boardRow.boardId, board.id))
      .orderBy(asc(schema.boardRow.sortOrder)),
    db.select().from(schema.boardGroup).where(eq(schema.boardGroup.boardId, board.id)),
    db.select().from(schema.employee),
    db.select().from(schema.vehicle),
    db.select().from(schema.stationPlace),
    db
      .select()
      .from(schema.boardCrew)
      .where(eq(schema.boardCrew.boardId, board.id))
      .orderBy(asc(schema.boardCrew.sortOrder)),
    db.select().from(schema.baseSchedule).where(eq(schema.baseSchedule.boardId, board.id)),
  ]);

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  /* Alla pass i veckan, från samtliga tavlor — dubbelbokning ska hittas
     även när den andra bokningen ligger på en annan tavla. */
  const [allRows, allBoards, rawAssignments] = await Promise.all([
    db.select().from(schema.boardRow),
    db.select().from(schema.board),
    db
      .select()
      .from(schema.assignment)
      .where(and(gte(schema.assignment.date, first), lte(schema.assignment.date, last))),
  ]);
  const rowInfo = new Map(allRows.map((r) => [r.id, r]));
  const boardName = new Map(allBoards.map((b) => [b.id, b.name]));

  const globalAssignments: AssignmentLike[] = rawAssignments.map((a) => {
    const row = rowInfo.get(a.boardRowId);
    return {
      id: a.id,
      boardRowId: a.boardRowId,
      date: a.date,
      shift: a.shift,
      slot: a.slot,
      employeeId: a.employeeId,
      vehicleId: a.vehicleId ?? row?.defaultVehicleId ?? null,
      boardId: row?.boardId ?? "",
      boardName: boardName.get(row?.boardId ?? "") ?? "",
      rowLabel: row ? (row.sublabel ? `${row.label} ${row.sublabel}` : row.label) : "",
    };
  });

  const rawAbsences = await db
    .select()
    .from(schema.absence)
    .where(and(lte(schema.absence.fromDate, last), gte(schema.absence.toDate, first)));
  const absenceLikes: AbsenceLike[] = rawAbsences.map((a) => ({
    employeeId: a.employeeId,
    fromDate: a.fromDate,
    toDate: a.toDate,
    type: a.type,
  }));

  const boardRowIds = new Set(rows.map((r) => r.id));
  const boardAssignments = globalAssignments.filter((a) => boardRowIds.has(a.boardRowId));

  const conflicts = [
    ...detectBookingConflicts({ assignments: globalAssignments, absences: absenceLikes, dates }),
    ...detectUnmanned([
      {
        rows: rows.map((r) => ({ id: r.id, validFrom: r.validFrom, validTo: r.validTo })),
        dates,
        shifts,
        assignments: boardAssignments,
      },
    ]),
  ];
  const index = indexConflicts(conflicts);

  const weekRows: WeekRow[] = rows.map((r) => {
    const cells: Record<string, CellAssignment[]> = {};
    for (const date of dates) for (const s of shifts) cells[`${date}|${s}`] = [];

    for (const a of rawAssignments) {
      if (a.boardRowId !== r.id) continue;
      const key = `${a.date}|${a.shift}`;
      if (!cells[key]) continue;
      const emp = a.employeeId ? employeeById.get(a.employeeId) : undefined;
      const veh = a.vehicleId ? vehicleById.get(a.vehicleId) : undefined;
      cells[key].push({
        id: a.id,
        slot: a.slot,
        employeeId: a.employeeId,
        employeeName: emp ? fullDisplayName(emp) : null,
        vehicleId: a.vehicleId,
        vehicleName: veh?.displayName ?? null,
        note: a.note,
        source: a.source,
        conflicts: index.byAssignment.get(a.id) ?? [],
      });
    }
    for (const key of Object.keys(cells)) cells[key].sort((x, y) => x.slot - y.slot);

    const def = r.defaultVehicleId ? vehicleById.get(r.defaultVehicleId) : undefined;
    return {
      id: r.id,
      label: r.label,
      sublabel: r.sublabel,
      color: r.color,
      groupId: r.groupId,
      groupLabel: r.groupId ? (groupById.get(r.groupId)?.label ?? null) : null,
      validTo: r.validTo,
      defaultVehicleId: r.defaultVehicleId,
      defaultVehicleName: def?.displayName ?? null,
      cells,
      inactiveDates: dates.filter(
        (d) => !isRowActive({ id: r.id, validFrom: r.validFrom, validTo: r.validTo }, d),
      ),
    };
  });

  /* Arbetsdagar för tavlans bemanning. */
  const crewIds = crewRows.map((c) => c.employeeId);
  const provider = getWorkDayProvider();
  const workDayResult =
    crewIds.length > 0
      ? await provider.getWorkDays(crewIds, first, last)
      : { workDays: [] as WorkDay[], covered: [] as string[] };

  const placedOn = new Set(
    boardAssignments
      .filter((a) => a.employeeId)
      .map((a) => `${a.employeeId}|${a.date}|${a.shift}`),
  );

  const crew: CrewMember[] = crewRows
    .map((c) => {
      const emp = employeeById.get(c.employeeId);
      const mine = workDayResult.workDays
        .filter((w) => w.employeeId === c.employeeId)
        .map((w) => ({ date: w.date, shift: w.shift }));
      const mineAbsences = rawAbsences.filter((a) => a.employeeId === c.employeeId);
      const abs = mineAbsences[0];
      const isAway = (date: string) =>
        mineAbsences.some((a) => date >= a.fromDate && date <= a.toDate);
      return {
        employeeId: c.employeeId,
        name: emp ? fullDisplayName(emp) : "Okänd",
        stationPlace: emp?.stationPlaceId ? (stationById.get(emp.stationPlaceId)?.name ?? null) : null,
        workDays: mine,
        // Ledig är inte samma sak som ej utlagd — annars tjatar listan om
        // semester och slutar fungera som veckans kvitto.
        unplaced: mine.filter(
          (w) => !placedOn.has(`${c.employeeId}|${w.date}|${w.shift}`) && !isAway(w.date),
        ),
        absence: abs ? { type: abs.type, fromDate: abs.fromDate, toDate: abs.toDate } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  /* Personvyn — samma pass, personerna som rader. Bemanningen finns
     med även utan pass, så det syns vem som saknar utläggning. */
  const personIds = [
    ...new Set([
      ...crewIds,
      ...boardAssignments.map((a) => a.employeeId).filter((v): v is string => v !== null),
    ]),
  ];
  const worksOn = new Set(workDayResult.workDays.map((w) => `${w.employeeId}|${w.date}`));

  const personRows = personIds
    .map((employeeId) => {
      const emp = employeeById.get(employeeId);
      const days: PersonDay[] = dates.map((date) => {
        const entries = rawAssignments
          .filter(
            (a) => a.employeeId === employeeId && a.date === date && boardRowIds.has(a.boardRowId),
          )
          .map((a) => {
            const row = rowInfo.get(a.boardRowId);
            // Passets egen bil vinner, annars radens standardbil.
            const vehicleId = a.vehicleId ?? row?.defaultVehicleId ?? null;
            return {
              rowLabel: row?.label ?? "",
              vehicleName: vehicleId ? (vehicleById.get(vehicleId)?.displayName ?? null) : null,
              shift: a.shift,
              note: a.note,
            };
          });
        const abs = rawAbsences.find(
          (x) => x.employeeId === employeeId && date >= x.fromDate && date <= x.toDate,
        );
        return {
          date,
          entries,
          absence: abs ? { type: abs.type, note: abs.note } : null,
          worksButUnplaced:
            entries.length === 0 && !abs && worksOn.has(`${employeeId}|${date}`),
        };
      });
      return { employeeId, name: emp ? fullDisplayName(emp) : "Okänd", days };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  /* Arbetsmönstren för bemanningen, till mönsterredigeraren. */
  const patternRows = crewIds.length
    ? await db
        .select()
        .from(schema.workPattern)
        .where(inArray(schema.workPattern.employeeId, crewIds))
    : [];
  const patternDays = patternRows.length
    ? await db
        .select()
        .from(schema.workPatternDay)
        .where(
          inArray(
            schema.workPatternDay.workPatternId,
            patternRows.map((p) => p.id),
          ),
        )
    : [];

  return {
    board,
    year,
    week,
    dates,
    shifts,
    rows: weekRows,
    personRows,
    conflicts,
    crew,
    workDaySource: provider.name,
    groups: groups
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({ id: g.id, label: g.label })),
    vehicles: vehicles
      .filter((v) => v.isActive)
      .map((v) => ({ id: v.id, name: v.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv")),
    baseSchedule: baseRows.map((b) => ({
      id: b.id,
      boardRowId: b.boardRowId,
      employeeId: b.employeeId,
      shift: b.shift,
      validFrom: b.validFrom,
      validTo: b.validTo,
    })),
    patterns: patternRows.map((p) => ({
      employeeId: p.employeeId,
      cycleWeeks: p.cycleWeeks,
      anchorDate: p.anchorDate,
      weekStartsOn: p.weekStartsOn,
      days: patternDays
        .filter((d) => d.workPatternId === p.id)
        .map((d) => ({ cycleWeek: d.cycleWeek, weekday: d.weekday, shift: d.shift })),
    })),
  };
}
