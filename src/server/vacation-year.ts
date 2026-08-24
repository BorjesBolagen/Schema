import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema, readWithTimeout } from "@/db";
import { fullDisplayName } from "@/lib/name";
import type { AbsenceType } from "@/lib/absence";
import { mondayOfWeek, weeksInYear, addDays } from "@/lib/week";

export interface AbsenceSpan {
  id: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  type: AbsenceType;
  status: "requested" | "approved";
  note: string | null;
  /** Veckonumren spannet täcker, för att rita staplarna. */
  weeks: number[];
}

export interface VacationRow {
  employeeId: string;
  name: string;
  stationPlace: string | null;
  absences: AbsenceSpan[];
}

export interface VacationYear {
  board: typeof schema.board.$inferSelect;
  year: number;
  weeks: number[];
  rows: VacationRow[];
  /** Antal i bemanningen som är tillgängliga, per veckonummer. */
  availablePerWeek: Record<number, number>;
  crewSize: number;
}

/** Veckonumren ett datumspann berör under ett givet år. */
export function weeksOfSpan(year: number, fromDate: string, toDate: string): number[] {
  const total = weeksInYear(year);
  const out: number[] = [];
  for (let w = 1; w <= total; w++) {
    const start = mondayOfWeek(year, w);
    const end = addDays(start, 6);
    if (fromDate <= end && toDate >= start) out.push(w);
  }
  return out;
}

export async function getVacationYear(slug: string, year: number): Promise<VacationYear | null> {
  return readWithTimeout(() => runGetVacationYear(slug, year));
}

async function runGetVacationYear(slug: string, year: number): Promise<VacationYear | null> {
  const db = getDb();
  const [board] = await db.select().from(schema.board).where(eq(schema.board.slug, slug));
  if (!board) return null;

  // Seriellt, inte parallellt — se kommentaren i board-week.ts:
  // pipelinade frågor genom Supabases pooler kan fastna.
  const crewRows = await db
    .select()
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id))
    .orderBy(asc(schema.boardCrew.sortOrder));
  const stations = await db.select().from(schema.stationPlace);
  const crewIds = crewRows.map((c) => c.employeeId);

  const employees = crewIds.length
    ? await db.select().from(schema.employee).where(inArray(schema.employee.id, crewIds))
    : [];
  const stationById = new Map(stations.map((s) => [s.id, s]));

  const yearStart = mondayOfWeek(year, 1);
  const yearEnd = addDays(mondayOfWeek(year, weeksInYear(year)), 6);
  const raw = crewIds.length
    ? await db
        .select()
        .from(schema.absence)
        .where(
          and(
            inArray(schema.absence.employeeId, crewIds),
            lte(schema.absence.fromDate, yearEnd),
            gte(schema.absence.toDate, yearStart),
          ),
        )
    : [];

  const weeks = Array.from({ length: weeksInYear(year) }, (_, i) => i + 1);
  const rows: VacationRow[] = employees
    .map((e) => ({
      employeeId: e.id,
      name: fullDisplayName(e),
      stationPlace: e.stationPlaceId ? (stationById.get(e.stationPlaceId)?.name ?? null) : null,
      absences: raw
        .filter((a) => a.employeeId === e.id)
        .map((a) => ({
          id: a.id,
          employeeId: a.employeeId,
          fromDate: a.fromDate,
          toDate: a.toDate,
          type: a.type as AbsenceType,
          status: a.status,
          note: a.note,
          weeks: weeksOfSpan(year, a.fromDate, a.toDate),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  /* Bemanning kvar per vecka — det som avgör om en vecka går att köra. */
  const availablePerWeek: Record<number, number> = {};
  for (const w of weeks) {
    const away = rows.filter((r) =>
      r.absences.some((a) => a.status === "approved" && a.weeks.includes(w)),
    ).length;
    availablePerWeek[w] = rows.length - away;
  }

  return { board, year, weeks, rows, availablePerWeek, crewSize: rows.length };
}
