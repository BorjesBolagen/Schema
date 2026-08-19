"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shift } from "@/lib/work-days";
import { weekDates } from "@/lib/week";
import { getWorkDayProvider } from "@/server/work-days";
import { planWeek, type ExistingAssignment } from "@/server/fill-week";

const refresh = (slug: string) => revalidatePath(`/tavla/${slug}`);

/** Lägger ut en person i en cell. */
export async function assignEmployee(input: {
  boardRowId: string;
  date: string;
  shift: Shift;
  employeeId: string;
  boardSlug: string;
}): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.boardRowId, input.boardRowId),
        eq(schema.assignment.date, input.date),
        eq(schema.assignment.shift, input.shift),
      ),
    );

  // Redan i cellen? Då är det inget att göra.
  if (existing.some((a) => a.employeeId === input.employeeId)) return;

  const used = new Set(existing.map((a) => a.slot));
  let slot = 0;
  while (used.has(slot)) slot++;

  await db.insert(schema.assignment).values({
    boardRowId: input.boardRowId,
    date: input.date,
    shift: input.shift,
    slot,
    employeeId: input.employeeId,
    source: "manual",
  });
  refresh(input.boardSlug);
}

/**
 * Flyttar ett pass till en annan cell.
 *
 * Flytten gör passet handpålagt — annars skulle nästa "Fyll veckan"
 * dra tillbaka det till bas-schemats plats.
 */
export async function moveAssignment(input: {
  assignmentId: string;
  boardRowId: string;
  date: string;
  shift: Shift;
  copy?: boolean;
  boardSlug: string;
}): Promise<void> {
  const db = getDb();
  const [source] = await db
    .select()
    .from(schema.assignment)
    .where(eq(schema.assignment.id, input.assignmentId));
  if (!source) return;

  const target = await db
    .select()
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.boardRowId, input.boardRowId),
        eq(schema.assignment.date, input.date),
        eq(schema.assignment.shift, input.shift),
      ),
    );

  const alreadyThere = target.some(
    (a) => a.id !== source.id && a.employeeId === source.employeeId,
  );
  if (alreadyThere) {
    if (!input.copy) await db.delete(schema.assignment).where(eq(schema.assignment.id, source.id));
    refresh(input.boardSlug);
    return;
  }

  const used = new Set(target.filter((a) => a.id !== source.id).map((a) => a.slot));
  let slot = 0;
  while (used.has(slot)) slot++;

  if (input.copy) {
    await db.insert(schema.assignment).values({
      boardRowId: input.boardRowId,
      date: input.date,
      shift: input.shift,
      slot,
      employeeId: source.employeeId,
      vehicleId: source.vehicleId,
      note: source.note,
      source: "manual",
    });
  } else {
    await db
      .update(schema.assignment)
      .set({
        boardRowId: input.boardRowId,
        date: input.date,
        shift: input.shift,
        slot,
        source: "manual",
        updatedAt: new Date(),
      })
      .where(eq(schema.assignment.id, source.id));
  }
  refresh(input.boardSlug);
}

export async function removeAssignment(assignmentId: string, boardSlug: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.assignment).where(eq(schema.assignment.id, assignmentId));
  refresh(boardSlug);
}

export async function setAssignmentNote(
  assignmentId: string,
  note: string | null,
  boardSlug: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.assignment)
    .set({ note: note?.trim() || null, source: "manual", updatedAt: new Date() })
    .where(eq(schema.assignment.id, assignmentId));
  refresh(boardSlug);
}

export interface FillResult {
  created: number;
  removed: number;
  unplaced: Array<{ employeeId: string; date: string; shift: Shift }>;
}

/**
 * Fyller veckan ur bas-schemat och personernas arbetsdagar.
 *
 * Idempotent: bara automatgenererade pass skrivs om, så knappen går att
 * trycka på igen när arbetsdagarna ändrats utan att handpåläggningen
 * försvinner.
 */
export async function fillWeek(input: {
  boardId: string;
  boardSlug: string;
  year: number;
  week: number;
}): Promise<FillResult> {
  const db = getDb();
  const [board] = await db.select().from(schema.board).where(eq(schema.board.id, input.boardId));
  if (!board) return { created: 0, removed: 0, unplaced: [] };

  const dates = weekDates(input.year, input.week, board.weekStartsOn, board.visibleWeekdays);
  const first = dates[0];
  const last = dates[dates.length - 1];

  const [crew, baseRows, rows, absences] = await Promise.all([
    db.select().from(schema.boardCrew).where(eq(schema.boardCrew.boardId, board.id)),
    db.select().from(schema.baseSchedule).where(eq(schema.baseSchedule.boardId, board.id)),
    db.select().from(schema.boardRow).where(eq(schema.boardRow.boardId, board.id)),
    db
      .select()
      .from(schema.absence)
      .where(and(lte(schema.absence.fromDate, last), gte(schema.absence.toDate, first))),
  ]);

  const rowIds = rows.map((r) => r.id);
  const existingRaw = rowIds.length
    ? await db
        .select()
        .from(schema.assignment)
        .where(
          and(
            inArray(schema.assignment.boardRowId, rowIds),
            gte(schema.assignment.date, first),
            lte(schema.assignment.date, last),
          ),
        )
    : [];

  const existing: ExistingAssignment[] = existingRaw.map((a) => ({
    id: a.id,
    boardRowId: a.boardRowId,
    date: a.date,
    shift: a.shift,
    slot: a.slot,
    employeeId: a.employeeId,
    source: a.source,
  }));

  const { workDays } = await getWorkDayProvider().getWorkDays(
    crew.map((c) => c.employeeId),
    first,
    last,
  );

  const plan = planWeek({
    workDays,
    baseSchedule: baseRows.map((b) => ({
      boardRowId: b.boardRowId,
      employeeId: b.employeeId,
      shift: b.shift,
      validFrom: b.validFrom,
      validTo: b.validTo,
      sortOrder: b.sortOrder,
    })),
    existing,
    absences: absences.map((a) => ({
      employeeId: a.employeeId,
      fromDate: a.fromDate,
      toDate: a.toDate,
    })),
    dates,
  });

  if (plan.deleteIds.length) {
    await db.delete(schema.assignment).where(inArray(schema.assignment.id, plan.deleteIds));
  }
  if (plan.create.length) {
    await db
      .insert(schema.assignment)
      .values(plan.create.map((c) => ({ ...c, source: "generated" as const })));
  }

  refresh(input.boardSlug);
  return { created: plan.create.length, removed: plan.deleteIds.length, unplaced: plan.unplaced };
}

/** Sätter vilka personer tavlan hanterar. */
export async function setCrew(
  boardId: string,
  employeeIds: string[],
  boardSlug: string,
): Promise<void> {
  const db = getDb();
  await db.delete(schema.boardCrew).where(eq(schema.boardCrew.boardId, boardId));
  if (employeeIds.length) {
    await db
      .insert(schema.boardCrew)
      .values(employeeIds.map((employeeId, i) => ({ boardId, employeeId, sortOrder: i })));
  }
  refresh(boardSlug);
}

export async function addBaseScheduleEntry(input: {
  boardId: string;
  boardRowId: string;
  employeeId: string;
  shift: Shift;
  validFrom: string | null;
  boardSlug: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.baseSchedule).values({
    boardId: input.boardId,
    boardRowId: input.boardRowId,
    employeeId: input.employeeId,
    shift: input.shift,
    validFrom: input.validFrom,
  });
  refresh(input.boardSlug);
}

export async function removeBaseScheduleEntry(id: string, boardSlug: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.baseSchedule).where(eq(schema.baseSchedule.id, id));
  refresh(boardSlug);
}
