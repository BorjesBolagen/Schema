"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shift } from "@/lib/work-days";
import { addDays, mondayOfWeek, weekDates, weekSpan } from "@/lib/week";
import { requireUser } from "@/server/auth";
import { assertBoardAccess, requireBoardBySlug } from "@/server/access";
import { getWorkDayProvider } from "@/server/work-days";
import { planWeek, type ExistingAssignment } from "@/server/fill-week";
import { fetchWeekShifts, type ShiftFetchResult } from "@/server/shift-fetch";
import {
  clearWeekAssignments,
  weekClearFacts,
  type WeekClearFacts,
} from "@/server/boards";
export type { WeekClearFacts };
export type { ShiftFetchResult };

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

export interface WeekPlacement {
  placed: number;
  /** Dagar personen inte kunde läggas ut, med orsak. */
  skipped: Array<{ date: string; reason: "frånvaro" | "redan utlagd" }>;
  /** Sant när personen lades till i tavlans bemanning på köpet. */
  addedToCrew: boolean;
  /** Sant när personen inte har något hämtat schema veckan — då blir veckan tom. */
  missingSchedule: boolean;
}

/**
 * Lägger ut en persons hela vecka på en rad.
 *
 * Det här är vad som händer när någon släpps på radhuvudet i stället
 * för i en enskild cell: personens arbetsdagar läses för veckan tavlan
 * visar, och hen läggs ut på alla dagar hen jobbar. Poängen är att en
 * bil bemannas i en rörelse i stället för fem.
 *
 * Arbetsdagarna kommer ur de pass som hämtats från TransPA. Har ingen
 * tryckt "Hämta schema" för veckan blir den tom, och det sägs rakt ut i
 * stället för att se ut som att dragningen inte fungerade.
 *
 * Personen läggs till i bemanningen om hen inte redan finns där, så att
 * en sökträff går att dra ut direkt utan att först gå via
 * personalväljaren.
 */
export async function assignEmployeeWeek(input: {
  boardRowId: string;
  employeeId: string;
  year: number;
  week: number;
  boardSlug: string;
}): Promise<WeekPlacement> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.boardRow)
    .where(and(eq(schema.boardRow.id, input.boardRowId), eq(schema.boardRow.boardId, board.id)));
  // Raden måste tillhöra tavlan — annars vore det en väg att skriva på
  // en tavla man inte har tillgång till.
  if (!row) return { placed: 0, skipped: [], addedToCrew: false, missingSchedule: false };

  const dates = weekDates(input.year, input.week, board.weekStartsOn, board.visibleWeekdays);
  const first = dates[0];
  const last = dates[dates.length - 1];

  const [inCrew] = await db
    .select({ employeeId: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(
      and(
        eq(schema.boardCrew.boardId, board.id),
        eq(schema.boardCrew.employeeId, input.employeeId),
      ),
    );
  if (!inCrew) {
    await db
      .insert(schema.boardCrew)
      .values({ boardId: board.id, employeeId: input.employeeId })
      .onConflictDoNothing();
  }

  const { workDays } = await getWorkDayProvider().getWorkDays([input.employeeId], first, last);
  const absences = await db
    .select()
    .from(schema.absence)
    .where(
      and(
        eq(schema.absence.employeeId, input.employeeId),
        lte(schema.absence.fromDate, last),
        gte(schema.absence.toDate, first),
      ),
    );
  const away = (date: string) => absences.some((a) => a.fromDate <= date && a.toDate >= date);

  const existing = await db
    .select()
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.boardRowId, input.boardRowId),
        gte(schema.assignment.date, first),
        lte(schema.assignment.date, last),
      ),
    );

  const visible = new Set(board.visibleShifts);
  const skipped: WeekPlacement["skipped"] = [];
  const create: Array<typeof schema.assignment.$inferInsert> = [];

  for (const day of workDays) {
    if (!dates.includes(day.date) || !visible.has(day.shift)) continue;
    if (away(day.date)) {
      skipped.push({ date: day.date, reason: "frånvaro" });
      continue;
    }

    const inCell = existing.filter((a) => a.date === day.date && a.shift === day.shift);
    if (inCell.some((a) => a.employeeId === input.employeeId)) {
      skipped.push({ date: day.date, reason: "redan utlagd" });
      continue;
    }

    // Nästa lediga plats i cellen — samma regel som när ett enskilt
    // pass läggs ut för hand.
    const used = new Set([
      ...inCell.map((a) => a.slot),
      ...create.filter((c) => c.date === day.date && c.shift === day.shift).map((c) => c.slot!),
    ]);
    let slot = 0;
    while (used.has(slot)) slot++;

    create.push({
      boardRowId: input.boardRowId,
      date: day.date,
      shift: day.shift,
      slot,
      employeeId: input.employeeId,
      source: "manual",
    });
  }

  if (create.length) await db.insert(schema.assignment).values(create);
  refresh(input.boardSlug);

  return {
    placed: create.length,
    skipped,
    addedToCrew: !inCrew,
    missingSchedule: workDays.length === 0,
  };
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

  // Seriellt, inte parallellt — se kommentaren i board-week.ts:
  // pipelinade frågor genom Supabases pooler kan fastna.
  const crew = await db
    .select()
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id));
  const baseRows = await db
    .select()
    .from(schema.baseSchedule)
    .where(eq(schema.baseSchedule.boardId, board.id));
  const rows = await db
    .select()
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, board.id));
  const absences = await db
    .select()
    .from(schema.absence)
    .where(and(lte(schema.absence.fromDate, last), gte(schema.absence.toDate, first)));

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

/* ------------------------------------------------------------------ *
 * Rensa veckan
 * ------------------------------------------------------------------ */

/**
 * Vad en rensning av veckan skulle ta med sig.
 *
 * Tavlan slås upp på slug och spannet räknas fram här, inte av
 * klienten. Ett id som kommer utifrån är inte bundet till den tavla
 * behörigheten gäller.
 */
export async function weekClearPreview(input: {
  boardSlug: string;
  year: number;
  week: number;
}): Promise<WeekClearFacts> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  const { from, to } = weekSpan(input.year, input.week, board.weekStartsOn);
  return weekClearFacts(board.id, from, to);
}

/**
 * Tömmer veckan på pass.
 *
 * Hela spannet, inte bara de synliga dagarna: ett pass på en dold dag
 * är osynligt men verkligt, och att lämna kvar det efter en rensning
 * vore en lögn.
 *
 * Bemanningen, bas-schemat och de hämtade passen står kvar, så veckan
 * går att fylla igen med ett tryck.
 */
export async function clearWeek(input: {
  boardSlug: string;
  year: number;
  week: number;
}): Promise<{ removed: number }> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  const { from, to } = weekSpan(input.year, input.week, board.weekStartsOn);
  const removed = await clearWeekAssignments(board.id, from, to);
  refresh(input.boardSlug);
  return { removed };
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
 * Schemahämtning
 * ------------------------------------------------------------------ */

/**
 * Hämtar veckans pass från TransPA för tavlans bemanning.
 *
 * En vecka i taget, en person i taget, och bara när någon ber om det.
 * Ett svep över hela bolaget lät effektivt men hämtade tusentals pass
 * ingen bett om och sprängde TransPA:s gräns på 31 dagar per anrop —
 * utan att göra den vecka man tittar på färskare.
 *
 * Passen skrivs till databasen, och tavelvyn läser dem därifrån. Ett
 * nätanrop i renderingsvägen fällde tidigare hela sidan när TransPA gick
 * trögt.
 */
export async function fetchShiftsForWeek(input: {
  boardSlug: string;
  year: number;
  week: number;
}): Promise<ShiftFetchResult> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);

  const crew = await getDb()
    .select({ employeeId: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id));

  const dates = weekDates(input.year, input.week, board.weekStartsOn, board.visibleWeekdays);
  const result = await fetchWeekShifts(
    crew.map((c) => c.employeeId),
    dates[0],
    dates[dates.length - 1],
  );

  refresh(input.boardSlug);
  return result;
}



/** Skriver om en persons mönster. Det tidigare ersätts. */

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
