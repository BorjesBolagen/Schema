import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
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
import { weekDates } from "@/lib/week";

export interface CellAssignment {
  id: string;
  slot: number;
  employeeId: string | null;
  employeeName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
  conflicts: Conflict[];
}

export interface WeekRow {
  id: string;
  label: string;
  sublabel: string | null;
  color: string | null;
  groupLabel: string | null;
  defaultVehicleId: string | null;
  defaultVehicleName: string | null;
  /** Nyckel `datum` → tilldelningar i cellen, sorterade på slot. */
  cells: Record<string, CellAssignment[]>;
  /** Datum där raden ligger utanför sitt giltighetsintervall. */
  inactiveDates: string[];
}

export interface PersonDay {
  date: string;
  entries: Array<{ rowLabel: string; vehicleName: string | null; note: string | null }>;
  absence: { type: string; note: string | null } | null;
}

export interface BoardWeek {
  board: typeof schema.board.$inferSelect;
  year: number;
  week: number;
  dates: string[];
  rows: WeekRow[];
  /** Personvyn: samma tilldelningar med personerna som rader. */
  personRows: Array<{ employeeId: string; name: string; days: PersonDay[] }>;
  conflicts: Conflict[];
  /** Frånvaro som berör veckan, för sidopanelen. */
  absences: Array<{ employeeId: string; name: string; type: string; fromDate: string; toDate: string }>;
  /** Förare utan bokning en viss dag — nyckel `datum`. */
  availableByDate: Record<string, Array<{ id: string; name: string }>>;
}

const fullName = fullDisplayName;

export async function getBoardBySlug(slug: string) {
  const db = getDb();
  const [board] = await db.select().from(schema.board).where(eq(schema.board.slug, slug));
  return board ?? null;
}

export async function listBoards() {
  const db = getDb();
  return db.select().from(schema.board).orderBy(asc(schema.board.sortOrder), asc(schema.board.name));
}

export async function getBoardWeek(slug: string, year: number, week: number): Promise<BoardWeek | null> {
  const db = getDb();
  const board = await getBoardBySlug(slug);
  if (!board) return null;

  const dates = weekDates(year, week, board.weekStartsOn, board.visibleWeekdays);
  const first = dates[0];
  const last = dates[dates.length - 1];

  const [rows, groups, employees, vehicles] = await Promise.all([
    db
      .select()
      .from(schema.boardRow)
      .where(eq(schema.boardRow.boardId, board.id))
      .orderBy(asc(schema.boardRow.sortOrder)),
    db.select().from(schema.boardGroup).where(eq(schema.boardGroup.boardId, board.id)),
    db.select().from(schema.employee),
    db.select().from(schema.vehicle),
  ]);

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  /* Alla tilldelningar i veckan, från samtliga tavlor — dubbelbokning
     ska hittas även när den andra bokningen ligger på en annan tavla. */
  const allRows = await db.select().from(schema.boardRow);
  const allBoards = await db.select().from(schema.board);
  const rowInfo = new Map(allRows.map((r) => [r.id, r]));
  const boardName = new Map(allBoards.map((b) => [b.id, b.name]));

  const rawAssignments = await db
    .select()
    .from(schema.assignment)
    .where(and(gte(schema.assignment.date, first), lte(schema.assignment.date, last)));

  const globalAssignments: AssignmentLike[] = rawAssignments.map((a) => {
    const row = rowInfo.get(a.boardRowId);
    return {
      id: a.id,
      boardRowId: a.boardRowId,
      date: a.date,
      slot: a.slot,
      employeeId: a.employeeId,
      vehicleId: a.vehicleId,
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
        assignments: boardAssignments,
      },
    ]),
  ];
  const index = indexConflicts(conflicts);

  const weekRows: WeekRow[] = rows.map((r) => {
    const cells: Record<string, CellAssignment[]> = {};
    for (const date of dates) cells[date] = [];
    for (const a of rawAssignments) {
      if (a.boardRowId !== r.id) continue;
      if (!cells[a.date]) continue;
      const emp = a.employeeId ? employeeById.get(a.employeeId) : undefined;
      const veh = a.vehicleId ? vehicleById.get(a.vehicleId) : undefined;
      cells[a.date].push({
        id: a.id,
        slot: a.slot,
        employeeId: a.employeeId,
        employeeName: emp ? fullName(emp) : null,
        vehicleId: a.vehicleId,
        vehicleName: veh?.displayName ?? null,
        startTime: a.startTime,
        endTime: a.endTime,
        note: a.note,
        conflicts: index.byAssignment.get(a.id) ?? [],
      });
    }
    for (const date of dates) cells[date].sort((x, y) => x.slot - y.slot);

    const def = r.defaultVehicleId ? vehicleById.get(r.defaultVehicleId) : undefined;
    return {
      id: r.id,
      label: r.label,
      sublabel: r.sublabel,
      color: r.color,
      groupLabel: r.groupId ? (groupById.get(r.groupId)?.label ?? null) : null,
      defaultVehicleId: r.defaultVehicleId,
      defaultVehicleName: def?.displayName ?? null,
      cells,
      inactiveDates: dates.filter((d) => !isRowActive({ id: r.id, validFrom: r.validFrom, validTo: r.validTo }, d)),
    };
  });

  /* Personvyn — samma data, personerna som rader. */
  const personIds = [
    ...new Set(boardAssignments.map((a) => a.employeeId).filter((v): v is string => v !== null)),
  ];
  const absenceByEmployee = new Map<string, typeof rawAbsences>();
  for (const a of rawAbsences) {
    absenceByEmployee.set(a.employeeId, [...(absenceByEmployee.get(a.employeeId) ?? []), a]);
  }

  const personRows = personIds
    .map((employeeId) => {
      const emp = employeeById.get(employeeId);
      const days: PersonDay[] = dates.map((date) => {
        const entries = rawAssignments
          .filter((a) => a.employeeId === employeeId && a.date === date && boardRowIds.has(a.boardRowId))
          .map((a) => {
            const row = rowInfo.get(a.boardRowId);
            const veh = a.vehicleId ? vehicleById.get(a.vehicleId) : undefined;
            return {
              rowLabel: row?.label ?? "",
              vehicleName: veh?.displayName ?? null,
              note: a.note,
            };
          });
        const abs = (absenceByEmployee.get(employeeId) ?? []).find(
          (x) => date >= x.fromDate && date <= x.toDate,
        );
        return { date, entries, absence: abs ? { type: abs.type, note: abs.note } : null };
      });
      return { employeeId, name: emp ? fullName(emp) : "Okänd", days };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  /* Sidopanelen: vilka som är lediga respektive frånvarande per dag. */
  const availableByDate: BoardWeek["availableByDate"] = {};
  const activeEmployees = employees.filter((e) => e.isActive);
  for (const date of dates) {
    const booked = new Set(
      globalAssignments.filter((a) => a.date === date).map((a) => a.employeeId),
    );
    const away = new Set(
      absenceLikes.filter((a) => date >= a.fromDate && date <= a.toDate).map((a) => a.employeeId),
    );
    availableByDate[date] = activeEmployees
      .filter((e) => !booked.has(e.id) && !away.has(e.id))
      .map((e) => ({ id: e.id, name: fullName(e) }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }

  return {
    board,
    year,
    week,
    dates,
    rows: weekRows,
    personRows,
    conflicts,
    absences: rawAbsences.map((a) => ({
      employeeId: a.employeeId,
      name: employeeById.has(a.employeeId) ? fullName(employeeById.get(a.employeeId)!) : "Okänd",
      type: a.type,
      fromDate: a.fromDate,
      toDate: a.toDate,
    })),
    availableByDate,
  };
}
