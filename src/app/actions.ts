"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shift } from "@/lib/work-days";
import { addDays, mondayOfWeek, weekDates } from "@/lib/week";
import { requireUser } from "@/server/auth";
import { assertBoardAccess, requireBoardBySlug } from "@/server/access";
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db.delete(schema.assignment).where(eq(schema.assignment.id, assignmentId));
  refresh(boardSlug);
}

export async function setAssignmentNote(
  assignmentId: string,
  note: string | null,
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
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
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db.delete(schema.baseSchedule).where(eq(schema.baseSchedule.id, id));
  refresh(boardSlug);
}

/* ------------------------------------------------------------------ *
 * Tavelredigering
 *
 * Allt utseende ägs av trafikansvarig: radernas namn, ordning,
 * gruppering, vilka veckodagar och skift tavlan visar. Ingen av de
 * ändringarna ska kräva en utvecklare.
 * ------------------------------------------------------------------ */

export async function updateBoard(input: {
  boardId: string;
  boardSlug: string;
  name?: string;
  weekStartsOn?: number;
  visibleWeekdays?: number[];
  visibleShifts?: string[];
  cellFields?: string[];
}): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
  const db = getDb();
  const { boardId, boardSlug, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return;

  // En tavla utan veckodagar eller skift skulle visa ingenting alls.
  if (Array.isArray(patch.visibleWeekdays) && patch.visibleWeekdays.length === 0) return;
  if (Array.isArray(patch.visibleShifts) && patch.visibleShifts.length === 0) return;

  await db
    .update(schema.board)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.board.id, boardId));
  refresh(boardSlug);
}

export async function addBoardRow(input: {
  boardId: string;
  boardSlug: string;
  label: string;
  sublabel?: string | null;
  groupId?: string | null;
  defaultVehicleId?: string | null;
}): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
  const db = getDb();
  const rows = await db
    .select({ sortOrder: schema.boardRow.sortOrder })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, input.boardId));
  const next = rows.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

  await db.insert(schema.boardRow).values({
    boardId: input.boardId,
    label: input.label.trim() || "Ny rad",
    sublabel: input.sublabel?.trim() || null,
    groupId: input.groupId ?? null,
    defaultVehicleId: input.defaultVehicleId ?? null,
    sortOrder: next,
  });
  refresh(input.boardSlug);
}

export async function updateBoardRow(input: {
  rowId: string;
  boardSlug: string;
  label?: string;
  sublabel?: string | null;
  groupId?: string | null;
  color?: string | null;
  defaultVehicleId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
  const db = getDb();
  const { rowId, boardSlug, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return;

  await db
    .update(schema.boardRow)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.boardRow.id, rowId));
  refresh(boardSlug);
}

/**
 * Avslutar en rad i stället för att radera den.
 *
 * En inställd linje ska inte ta sin historik med sig — passen som redan
 * körts finns kvar, raden slutar bara visas framåt.
 */
export async function endBoardRow(rowId: string, lastDate: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db
    .update(schema.boardRow)
    .set({ validTo: lastDate, updatedAt: new Date() })
    .where(eq(schema.boardRow.id, rowId));
  refresh(boardSlug);
}

export async function deleteBoardRow(rowId: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db.delete(schema.boardRow).where(eq(schema.boardRow.id, rowId));
  refresh(boardSlug);
}

/** Sätter radernas ordning efter att de dragits om. */
export async function reorderBoardRows(rowIds: string[], boardSlug: string): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  for (const [i, id] of rowIds.entries()) {
    await db.update(schema.boardRow).set({ sortOrder: i }).where(eq(schema.boardRow.id, id));
  }
  refresh(boardSlug);
}

export async function addBoardGroup(
  boardId: string,
  label: string,
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  const groups = await db
    .select({ sortOrder: schema.boardGroup.sortOrder })
    .from(schema.boardGroup)
    .where(eq(schema.boardGroup.boardId, boardId));
  const next = groups.reduce((max, g) => Math.max(max, g.sortOrder), -1) + 1;

  await db
    .insert(schema.boardGroup)
    .values({ boardId, label: label.trim() || "Ny grupp", sortOrder: next });
  refresh(boardSlug);
}

export async function renameBoardGroup(
  groupId: string,
  label: string,
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db
    .update(schema.boardGroup)
    .set({ label: label.trim() || "Ny grupp" })
    .where(eq(schema.boardGroup.id, groupId));
  refresh(boardSlug);
}

/** Tar bort en grupprubrik. Raderna blir kvar, utan gruppering. */
export async function deleteBoardGroup(groupId: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db.delete(schema.boardGroup).where(eq(schema.boardGroup.id, groupId));
  refresh(boardSlug);
}

/* ------------------------------------------------------------------ *
 * Arbetsmönster
 * ------------------------------------------------------------------ */

export interface PatternDayInput {
  cycleWeek: number;
  weekday: number;
  shift: Shift;
}

/**
 * Sparar en persons arbetsmönster.
 *
 * Ett mönster per person i taget — det tidigare ersätts. Historiska
 * mönster med giltighetsperiod hanteras när TransPA-hämtningen finns;
 * tills dess är det här reservkällan och ska vara enkel att rätta.
 */
export async function saveWorkPattern(input: {
  employeeId: string;
  cycleWeeks: number;
  anchorDate: string;
  weekStartsOn: number;
  days: PatternDayInput[];
  boardSlug: string;
}): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
  await writePattern(input.employeeId, input);
  refresh(input.boardSlug);
}

/**
 * Lägger samma mönster på flera personer.
 *
 * Nästan alla kör måndag till fredag. Att klicka i det en person i taget
 * för ett helt åkeri är ett rent tidsslöseri, och det som annars står
 * mellan en tom databas och en veckotavla som fylls. Vilka som träffas
 * avgörs av anroparen — normalt de som saknar mönster.
 */
export async function applyWorkPatternToMany(input: {
  employeeIds: string[];
  cycleWeeks: number;
  anchorDate: string;
  weekStartsOn: number;
  days: PatternDayInput[];
  boardSlug: string;
}): Promise<{ applied: number }> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);

  // Bara tavlans egen bemanning — annars skulle en planerare kunna
  // skriva om mönstret för folk hen inte hanterar.
  const crew = await getDb()
    .select({ employeeId: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id));
  const allowed = new Set(crew.map((c) => c.employeeId));
  const targets = input.employeeIds.filter((id) => allowed.has(id));

  for (const employeeId of targets) await writePattern(employeeId, input);
  refresh(input.boardSlug);
  return { applied: targets.length };
}

/** Skriver om en persons mönster. Det tidigare ersätts. */
async function writePattern(
  employeeId: string,
  input: { cycleWeeks: number; anchorDate: string; weekStartsOn: number; days: PatternDayInput[] },
): Promise<void> {
  const db = getDb();
  const cycleWeeks = Math.min(8, Math.max(1, Math.round(input.cycleWeeks)));

  await db.delete(schema.workPattern).where(eq(schema.workPattern.employeeId, employeeId));
  if (input.days.length === 0) return;

  const [pattern] = await db
    .insert(schema.workPattern)
    .values({
      employeeId,
      cycleWeeks,
      anchorDate: input.anchorDate,
      weekStartsOn: input.weekStartsOn,
    })
    .returning();

  // Dagar utanför cykeln skulle aldrig kunna träffa och filtreras bort.
  const days = input.days.filter((d) => d.cycleWeek < cycleWeeks);
  if (days.length) {
    await db
      .insert(schema.workPatternDay)
      .values(days.map((d) => ({ ...d, workPatternId: pattern.id })))
      .onConflictDoNothing();
  }
}

/* ------------------------------------------------------------------ *
 * Frånvaro och semester
 * ------------------------------------------------------------------ */

/**
 * Lägger in frånvaro för ett veckospann.
 *
 * Överlappande frånvaro av samma typ slås ihop till ett spann i stället
 * för att staplas — annars blir årsvyn full av småbitar som beskriver
 * samma ledighet.
 */
export async function setAbsenceWeeks(input: {
  employeeId: string;
  year: number;
  weeks: number[];
  type: string;
  status: "requested" | "approved";
  boardSlug: string;
}): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
  if (input.weeks.length === 0) return;
  const db = getDb();

  const sorted = [...new Set(input.weeks)].sort((a, b) => a - b);
  const fromDate = mondayOfWeek(input.year, sorted[0]);
  const toDate = addDays(mondayOfWeek(input.year, sorted[sorted.length - 1]), 6);

  const overlapping = await db
    .select()
    .from(schema.absence)
    .where(
      and(
        eq(schema.absence.employeeId, input.employeeId),
        eq(schema.absence.type, input.type as never),
        lte(schema.absence.fromDate, toDate),
        gte(schema.absence.toDate, fromDate),
      ),
    );

  const merged = overlapping.reduce(
    (acc, a) => ({
      fromDate: a.fromDate < acc.fromDate ? a.fromDate : acc.fromDate,
      toDate: a.toDate > acc.toDate ? a.toDate : acc.toDate,
    }),
    { fromDate, toDate },
  );

  if (overlapping.length) {
    await db.delete(schema.absence).where(
      inArray(
        schema.absence.id,
        overlapping.map((a) => a.id),
      ),
    );
  }

  await db.insert(schema.absence).values({
    employeeId: input.employeeId,
    fromDate: merged.fromDate,
    toDate: merged.toDate,
    type: input.type as never,
    status: input.status,
  });
  refresh(input.boardSlug);
}

/** Tar bort frånvaron som täcker en viss vecka. */
export async function clearAbsenceWeek(input: {
  employeeId: string;
  year: number;
  week: number;
  boardSlug: string;
}): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: input.boardSlug });
  const db = getDb();
  const start = mondayOfWeek(input.year, input.week);
  const end = addDays(start, 6);

  const hits = await db
    .select()
    .from(schema.absence)
    .where(
      and(
        eq(schema.absence.employeeId, input.employeeId),
        lte(schema.absence.fromDate, end),
        gte(schema.absence.toDate, start),
      ),
    );

  for (const a of hits) {
    const keepBefore = a.fromDate < start;
    const keepAfter = a.toDate > end;

    if (keepBefore && keepAfter) {
      // Veckan ligger mitt i ett längre spann — dela det i två.
      await db
        .update(schema.absence)
        .set({ toDate: addDays(start, -1), updatedAt: new Date() })
        .where(eq(schema.absence.id, a.id));
      await db.insert(schema.absence).values({
        employeeId: a.employeeId,
        fromDate: addDays(end, 1),
        toDate: a.toDate,
        type: a.type,
        status: a.status,
        note: a.note,
      });
    } else if (keepBefore) {
      await db
        .update(schema.absence)
        .set({ toDate: addDays(start, -1), updatedAt: new Date() })
        .where(eq(schema.absence.id, a.id));
    } else if (keepAfter) {
      await db
        .update(schema.absence)
        .set({ fromDate: addDays(end, 1), updatedAt: new Date() })
        .where(eq(schema.absence.id, a.id));
    } else {
      await db.delete(schema.absence).where(eq(schema.absence.id, a.id));
    }
  }
  refresh(input.boardSlug);
}

export async function setAbsenceStatus(
  absenceId: string,
  status: "requested" | "approved",
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  await assertBoardAccess(user, { slug: boardSlug });
  const db = getDb();
  await db
    .update(schema.absence)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.absence.id, absenceId));
  refresh(boardSlug);
}
