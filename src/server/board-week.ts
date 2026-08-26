import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema, readWithTimeout, rowsFromExecute } from "@/db";
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
  /**
   * Hela den aktiva personalen, färdig för personalväljaren.
   *
   * Byggs här därför att samlingsfrågan ändå hämtat personal och
   * stationsorter. Sidan hämtade tidigare båda en gång till — två turer
   * till databasen för uppgifter som redan låg i minnet.
   */
  pickerEmployees: Array<{
    id: string;
    name: string;
    employeeNumber: string | null;
    stationPlace: string | null;
    /** TransPA:s yrkesroll — chaufför, garage eller övrig. */
    professionGroup: string | null;
  }>;

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


/**
 * Formen på samlingsfrågan i runGetBoardWeek.
 *
 * Fältnamnen inuti listorna sätts av json_build_object och matchar
 * resten av koden; nycklarna på toppnivån är kolumnnamn och därför
 * snake_case.
 */
interface BoardWeekBundle {
  all_rows: Array<{
    id: string;
    boardId: string;
    groupId: string | null;
    label: string;
    sublabel: string | null;
    sortOrder: number;
    color: string | null;
    defaultVehicleId: string | null;
    validFrom: string | null;
    validTo: string | null;
  }>;
  groups: Array<{ id: string; label: string; sortOrder: number }>;
  employees: Array<{
    id: string;
    firstName: string;
    lastName: string;
    employeeNumber: string | null;
    stationPlaceId: string | null;
    professionGroup: string | null;
    isActive: boolean;
  }>;
  vehicles: Array<{ id: string; displayName: string; isActive: boolean }>;
  stations: Array<{ id: string; name: string }>;
  crew: Array<{ employeeId: string; sortOrder: number }>;
  base_schedule: Array<{
    id: string;
    boardRowId: string;
    employeeId: string;
    shift: Shift;
    validFrom: string | null;
    validTo: string | null;
  }>;
  all_boards: Array<{ id: string; name: string }>;
  assignments: Array<{
    id: string;
    boardRowId: string;
    date: string;
    shift: Shift;
    slot: number;
    employeeId: string | null;
    vehicleId: string | null;
    note: string | null;
    source: "generated" | "manual";
  }>;
  absences: Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    type: string;
    note: string | null;
  }>;
  patterns: Array<{
    id: string;
    employeeId: string;
    cycleWeeks: number;
    anchorDate: string;
    weekStartsOn: number;
    validFrom: string | null;
    validTo: string | null;
  }>;
  pattern_days: Array<{
    workPatternId: string;
    cycleWeek: number;
    weekday: number;
    shift: Shift;
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

/**
 * Hämtar veckan — tavla, rader, bemanning, arbetsdagar och konflikter.
 *
 * Bakom en tidsgräns (readWithTimeout): en fastnad fråga på den delade,
 * poolade anslutningen hänger annars kvar tills plattformens egen
 * gräns i stället för att ge ett läsligt fel på några sekunder. Se
 * readWithTimeout i src/db/index.ts för varför.
 */
export async function getBoardWeek(
  slug: string,
  year: number,
  week: number,
): Promise<BoardWeek | null> {
  return readWithTimeout(() => runGetBoardWeek(slug, year, week));
}

async function runGetBoardWeek(
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

  /* Allt underlag i **en** fråga.
   *
   * Sidan behöver ett tiotal listor, och varje separat fråga är en tur
   * till databasen. Mot Supabase från Vercel kostar en tur ungefär tio
   * millisekunder, så tio frågor blir en kvarts sekund ren väntan även
   * när själva databasen svarar på nolltid. Mätt vid 10 ms latens:
   * seriellt 277 ms, parallellt 64 ms, den här enda frågan 24 ms.
   *
   * En fråga är dessutom det enda upplägget som helt undviker
   * parallella, pipelinade frågor genom poolern — den misstänkta
   * orsaken till att just den här vyn hängde i drift. Snabbast och
   * säkrast råkar vara samma sak här.
   *
   * json_build_object ger fälten samma namn som resten av koden
   * använder, så inget mellanlager behövs för att översätta
   * kolumnnamnen.
   */
  const crewOfBoard = sql`select c.employee_id from board_crew c where c.board_id = ${board.id}`;
  const bundleRows = rowsFromExecute<BoardWeekBundle>(
    await db.execute(sql`
    select
      (select coalesce(json_agg(json_build_object(
        'id', r.id, 'boardId', r.board_id, 'groupId', r.group_id, 'label', r.label,
        'sublabel', r.sublabel, 'sortOrder', r.sort_order, 'color', r.color,
        'defaultVehicleId', r.default_vehicle_id, 'validFrom', r.valid_from,
        'validTo', r.valid_to) order by r.sort_order), '[]'::json)
       from board_row r) as all_rows,

      (select coalesce(json_agg(json_build_object(
        'id', g.id, 'label', g.label, 'sortOrder', g.sort_order) order by g.sort_order), '[]'::json)
       from board_group g where g.board_id = ${board.id}) as groups,

      (select coalesce(json_agg(json_build_object(
        'id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
        'employeeNumber', e.employee_number, 'stationPlaceId', e.station_place_id,
        'professionGroup', e.profession_group, 'isActive', e.is_active)), '[]'::json)
       from employee e) as employees,

      (select coalesce(json_agg(json_build_object(
        'id', v.id, 'displayName', v.display_name, 'isActive', v.is_active)), '[]'::json)
       from vehicle v) as vehicles,

      (select coalesce(json_agg(json_build_object(
        'id', p.id, 'name', p.name)), '[]'::json)
       from station_place p) as stations,

      (select coalesce(json_agg(json_build_object(
        'employeeId', c.employee_id, 'sortOrder', c.sort_order) order by c.sort_order), '[]'::json)
       from board_crew c where c.board_id = ${board.id}) as crew,

      (select coalesce(json_agg(json_build_object(
        'id', b.id, 'boardRowId', b.board_row_id, 'employeeId', b.employee_id,
        'shift', b.shift, 'validFrom', b.valid_from, 'validTo', b.valid_to)), '[]'::json)
       from base_schedule b where b.board_id = ${board.id}) as base_schedule,

      (select coalesce(json_agg(json_build_object(
        'id', b.id, 'name', b.name)), '[]'::json)
       from board b) as all_boards,

      (select coalesce(json_agg(json_build_object(
        'id', a.id, 'boardRowId', a.board_row_id, 'date', a.date, 'shift', a.shift,
        'slot', a.slot, 'employeeId', a.employee_id, 'vehicleId', a.vehicle_id,
        'note', a.note, 'source', a.source)), '[]'::json)
       from assignment a where a.date >= ${first} and a.date <= ${last}) as assignments,

      (select coalesce(json_agg(json_build_object(
        'employeeId', x.employee_id, 'fromDate', x.from_date, 'toDate', x.to_date,
        'type', x.type, 'note', x.note)), '[]'::json)
       from absence x where x.from_date <= ${last} and x.to_date >= ${first}) as absences,

      (select coalesce(json_agg(json_build_object(
        'id', w.id, 'employeeId', w.employee_id, 'cycleWeeks', w.cycle_weeks,
        'anchorDate', w.anchor_date, 'weekStartsOn', w.week_starts_on,
        'validFrom', w.valid_from, 'validTo', w.valid_to)), '[]'::json)
       from work_pattern w where w.employee_id in (${crewOfBoard})) as patterns,

      (select coalesce(json_agg(json_build_object(
        'workPatternId', d.work_pattern_id, 'cycleWeek', d.cycle_week,
        'weekday', d.weekday, 'shift', d.shift)), '[]'::json)
       from work_pattern_day d
       where d.work_pattern_id in (
         select w.id from work_pattern w where w.employee_id in (${crewOfBoard}))) as pattern_days
    `),
  );

  /* En tom lista här betyder att frågan inte gav någon rad alls — det
     ska inte gå, men att låta den falla vidare som "undefined.all_rows"
     skulle ge ett fel som inte pekar hit. */
  const bundle = bundleRows[0];
  if (!bundle) throw new Error("Kunde inte läsa tavelveckan: frågan gav ingen rad.");

  const allRows = bundle.all_rows;
  const rows = allRows.filter((r) => r.boardId === board.id);
  const groups = bundle.groups;
  const employees = bundle.employees;
  const vehicles = bundle.vehicles;
  const stations = bundle.stations;
  const crewRows = bundle.crew;
  const baseRows = bundle.base_schedule;
  const allBoards = bundle.all_boards;
  const rawAssignments = bundle.assignments;
  const rawAbsences = bundle.absences;
  const patternRows = bundle.patterns;
  const patternDays = bundle.pattern_days;

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

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
  const provider = getWorkDayProvider(undefined, { patterns: patternRows, days: patternDays });
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
    pickerEmployees: employees
      .filter((e) => e.isActive)
      .map((e) => ({
        id: e.id,
        name: fullDisplayName(e),
        employeeNumber: e.employeeNumber,
        stationPlace: e.stationPlaceId ? (stationById.get(e.stationPlaceId)?.name ?? null) : null,
        professionGroup: e.professionGroup,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv")),
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
