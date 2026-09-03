"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shift } from "@/lib/work-days";
import type { VehicleKind } from "@/lib/vehicle-kind";
import { addDays, mondayOfWeek, weekDates, weekSpan } from "@/lib/week";
import { MAX_CYCLE_WEEKS } from "@/lib/rotation";
import { requireUser } from "@/server/auth";
import { boardForAction, requireBoardBySlug } from "@/server/access";
import {
  assignmentOnBoard,
  employeeOnBoard,
  groupOnBoard,
  rowOnBoard,
  rowsOnBoard,
} from "@/server/board-scope";
import { getWorkDayProvider } from "@/server/work-days";
import { planWeek, type ExistingAssignment } from "@/server/fill-week";
import { fetchWeekShifts, type ShiftFetchResult } from "@/server/shift-fetch";
import {
  clearWeekAssignments,
  crewRemovalFacts,
  removeFromCrew,
  weekClearFacts,
  type CrewRemovalFacts,
  type WeekClearFacts,
} from "@/server/boards";
export type { CrewRemovalFacts, WeekClearFacts };
export type { ShiftFetchResult };

const refresh = (slug: string) => revalidatePath(`/tavla/${slug}`);

/** Lägger ut en person i en cell. */
/**
 * Plockar ut kända fält ur ett anrop.
 *
 * Uppdateringarna byggde sin patch med `...rest` och skickade den rakt
 * in i set(). Typen står i TypeScript, men på andra sidan nätet är
 * anropet bara JSON: en klient kan skicka med vilka nycklar som helst,
 * och `slug` eller `ownerId` hade följt med in i update-satsen. Att
 * räkna upp fälten är tråkigare och kan inte råka släppa igenom något.
 */
function plocka<T extends object, K extends keyof T>(
  källa: T,
  fält: readonly K[],
): { [P in K]?: T[P] } {
  const ut: { [P in K]?: T[P] } = {};
  for (const f of fält) if (källa[f] !== undefined) ut[f] = källa[f];
  return ut;
}

export async function assignEmployee(input: {
  boardRowId: string;
  date: string;
  shift: Shift;
  employeeId: string;
  boardSlug: string;
}): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, input.boardSlug);
  await rowOnBoard(board.id, input.boardRowId);
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
  /* Båda ändarna av flytten prövas: passet man tar och raden man
     släpper på. Bara den ena räckte inte — ett pass från en annan tavla
     gick att flytta in, och ett eget gick att flytta ut. */
  const board = await boardForAction(user, input.boardSlug);
  await assignmentOnBoard(board.id, input.assignmentId);
  await rowOnBoard(board.id, input.boardRowId);
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
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db
    .delete(schema.assignment)
    .where(eq(schema.assignment.id, await assignmentOnBoard(board.id, assignmentId)));
  refresh(boardSlug);
}

export async function setAssignmentNote(
  assignmentId: string,
  note: string | null,
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db
    .update(schema.assignment)
    .set({ note: note?.trim() || null, source: "manual", updatedAt: new Date() })
    .where(eq(schema.assignment.id, await assignmentOnBoard(board.id, assignmentId)));
  refresh(boardSlug);
}

export interface FillResult {
  created: number;
  removed: number;
  unplaced: Array<{ employeeId: string; date: string; shift: Shift }>;
  /** Personer som var kopplade till flera bilar lika starkt samma dag. */
  ambiguous: Array<{ employeeId: string; name: string; alternatives: number }>;
  /** Arbetsdagar på ett skift tavlan inte visar. */
  hiddenShift: number;
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
  /* Tavlan hämtas genom behörighetskontrollen, inte genom det boardId
     klienten skickade med. Slugen kontrollerades och id:t användes —
     två olika saker som ingenting band ihop. */
  const board = await boardForAction(user, input.boardSlug);
  const db = getDb();

  const dates = weekDates(input.year, input.week, board.weekStartsOn, board.visibleWeekdays);
  const first = dates[0];
  const last = dates[dates.length - 1];

  // Seriellt, inte parallellt — se kommentaren i board-week.ts:
  // pipelinade frågor genom Supabases pooler kan fastna.
  const crew = await db
    .select()
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id));
  /* Ordnad läsning, inte godtycklig radordning: planWeek väljer första
     träffen när flera bas-schemarader gäller samma dag, och det valet
     ska bli detsamma varje gång. */
  const baseRows = await db
    .select()
    .from(schema.baseSchedule)
    .where(eq(schema.baseSchedule.boardId, board.id))
    .orderBy(asc(schema.baseSchedule.sortOrder), asc(schema.baseSchedule.id));
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
      id: b.id,
      boardRowId: b.boardRowId,
      employeeId: b.employeeId,
      validFrom: b.validFrom,
      validTo: b.validTo,
      sortOrder: b.sortOrder,
      cycleWeeks: b.cycleWeeks,
      weekdays: b.weekdays,
      cycleLength: b.cycleLength,
      cycleOffset: b.cycleOffset,
    })),
    existing,
    absences: absences.map((a) => ({
      employeeId: a.employeeId,
      fromDate: a.fromDate,
      toDate: a.toDate,
    })),
    rows: rows.map((r) => ({ id: r.id, validFrom: r.validFrom, validTo: r.validTo })),
    visibleShifts: board.visibleShifts as Shift[],
    isoWeek: input.week,
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

  /* Tvetydigheterna sammanfattas per person: samma koppling ger samma
     val varje dag i veckan, så fem rader om samma sak vore brus. */
  const namn = new Map(
    (
      await db
        .select({
          id: schema.employee.id,
          firstName: schema.employee.firstName,
          lastName: schema.employee.lastName,
        })
        .from(schema.employee)
        .where(
          inArray(schema.employee.id, [...new Set(plan.ambiguous.map((a) => a.employeeId))]),
        )
    ).map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]),
  );
  const perPerson = new Map<string, number>();
  for (const a of plan.ambiguous) {
    perPerson.set(a.employeeId, Math.max(perPerson.get(a.employeeId) ?? 0, a.alternatives.length));
  }

  refresh(input.boardSlug);
  return {
    created: plan.create.length,
    removed: plan.deleteIds.length,
    unplaced: plan.unplaced,
    ambiguous: [...perPerson].map(([employeeId, alternatives]) => ({
      employeeId,
      name: namn.get(employeeId) ?? "Okänd",
      alternatives,
    })),
    hiddenShift: plan.hiddenShift.length,
  };
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

/** Vad en bortkoppling skulle ta med sig — underlag för bekräftelsen. */
export async function crewRemovalPreview(input: {
  boardSlug: string;
  employeeId: string;
}): Promise<CrewRemovalFacts> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  return crewRemovalFacts(board.id, await employeeOnBoard(board.id, input.employeeId));
}

/**
 * Kopplar bort en person från tavlan.
 *
 * Tavlan slås upp på slug och personen anges för sig, så bortkopplingen
 * inte kan träffa en tavla behörigheten inte gäller.
 */
export async function detachFromBoard(input: {
  boardSlug: string;
  employeeId: string;
}): Promise<void> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  await removeFromCrew(board.id, await employeeOnBoard(board.id, input.employeeId));
  refresh(input.boardSlug);
}

/** Sätter vilka personer tavlan hanterar. */
export async function setCrew(
  boardId: string,
  employeeIds: string[],
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db.delete(schema.boardCrew).where(eq(schema.boardCrew.boardId, board.id));
  if (employeeIds.length) {
    await db.insert(schema.boardCrew).values(
      employeeIds.map((employeeId, i) => ({ boardId: board.id, employeeId, sortOrder: i })),
    );
  }
  refresh(boardSlug);
}

export async function addBaseScheduleEntry(input: {
  boardRowId: string;
  employeeId: string;
  validFrom: string | null;
  boardSlug: string;
}): Promise<void> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  const db = getDb();

  /* Raden måste tillhöra tavlan. Ett radid som kommer från klienten är
     inte bundet till den tavla behörigheten gäller. */
  const [row] = await db
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(
      and(eq(schema.boardRow.id, input.boardRowId), eq(schema.boardRow.boardId, board.id)),
    );
  if (!row) return;

  /* Ny koppling hamnar sist bland personens befintliga, så den inte
     tar över en ordning någon redan satt. */
  const syskon = await db
    .select({ sortOrder: schema.baseSchedule.sortOrder })
    .from(schema.baseSchedule)
    .where(
      and(
        eq(schema.baseSchedule.boardId, board.id),
        eq(schema.baseSchedule.employeeId, input.employeeId),
      ),
    );

  await db.insert(schema.baseSchedule).values({
    boardId: board.id,
    boardRowId: input.boardRowId,
    employeeId: input.employeeId,
    validFrom: input.validFrom,
    sortOrder: syskon.length ? Math.max(...syskon.map((s) => s.sortOrder)) + 1 : 0,
  });
  refresh(input.boardSlug);
}

/**
 * Sätter när en koppling gäller.
 *
 * Tomma listor sparas som null, inte som tomma arrayer: null och tomt
 * betyder samma sak för planeringen ("alltid"), och två stavningar av
 * samma sak i databasen är en för mycket.
 */
export async function setBaseScheduleRule(input: {
  boardSlug: string;
  id: string;
  cycleWeeks: number[];
  weekdays: number[];
  /** Cykelns längd i veckor. 1 betyder varje vecka. */
  cycleLength: number;
  cycleOffset: number;
}): Promise<void> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  const db = getDb();

  await db
    .update(schema.baseSchedule)
    .set({
      /* Längden klämd inom det modellen kan visa, och förskjutningen
         inom längden — annars går det att spara en regel som aldrig
         träffar någon vecka. */
      cycleLength: Math.min(Math.max(1, Math.floor(input.cycleLength)), MAX_CYCLE_WEEKS),
      cycleOffset:
        ((Math.floor(input.cycleOffset) % Math.max(1, Math.floor(input.cycleLength))) +
          Math.max(1, Math.floor(input.cycleLength))) %
        Math.max(1, Math.floor(input.cycleLength)),
      cycleWeeks: input.cycleWeeks.length ? [...input.cycleWeeks].sort((a, b) => a - b) : null,
      weekdays: input.weekdays.length ? [...input.weekdays].sort((a, b) => a - b) : null,
    })
    .where(
      and(eq(schema.baseSchedule.id, input.id), eq(schema.baseSchedule.boardId, board.id)),
    );
  refresh(input.boardSlug);
}

/**
 * Sätter ordningen mellan en persons kopplingar på samma skift.
 *
 * Ordningen avgör vilken bil som vinner när flera kopplingar gäller
 * samma dag. Utan den valdes en av dem ur databasens godtyckliga
 * radordning, och personen kunde byta bil mellan två tryck på "Fyll
 * veckan".
 */
export async function reorderBaseSchedule(input: {
  boardSlug: string;
  ids: string[];
}): Promise<void> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, input.boardSlug);
  const db = getDb();

  const egna = await db
    .select({ id: schema.baseSchedule.id })
    .from(schema.baseSchedule)
    .where(
      and(
        eq(schema.baseSchedule.boardId, board.id),
        inArray(schema.baseSchedule.id, input.ids),
      ),
    );
  const tillatna = new Set(egna.map((e) => e.id));

  let ordning = 0;
  for (const id of input.ids) {
    if (!tillatna.has(id)) continue;
    await db
      .update(schema.baseSchedule)
      .set({ sortOrder: ordning++ })
      .where(eq(schema.baseSchedule.id, id));
  }
  refresh(input.boardSlug);
}

export async function removeBaseScheduleEntry(id: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, boardSlug);
  const db = getDb();
  // Avgränsat till tavlan: id:t kommer från klienten och är inte bundet.
  await db
    .delete(schema.baseSchedule)
    .where(and(eq(schema.baseSchedule.id, id), eq(schema.baseSchedule.boardId, board.id)));
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
  cycleLength?: number;
  cycleOffset?: number;
  name?: string;
  weekStartsOn?: number;
  visibleWeekdays?: number[];
  visibleShifts?: string[];
  cellFields?: string[];
}): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, input.boardSlug);
  const db = getDb();

  // Uppräknade fält i stället för spread — se plocka() ovan.
  const patch = plocka(input, [
    "name",
    "weekStartsOn",
    "visibleWeekdays",
    "visibleShifts",
    "cellFields",
  ]);
  if (Object.keys(patch).length === 0) return;

  // En tavla utan veckodagar eller skift skulle visa ingenting alls.
  if (Array.isArray(patch.visibleWeekdays) && patch.visibleWeekdays.length === 0) return;
  if (Array.isArray(patch.visibleShifts) && patch.visibleShifts.length === 0) return;

  await db
    .update(schema.board)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.board.id, board.id));
  refresh(input.boardSlug);
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
  const board = await boardForAction(user, input.boardSlug);
  if (input.groupId) await groupOnBoard(board.id, input.groupId);
  const db = getDb();
  const rows = await db
    .select({ sortOrder: schema.boardRow.sortOrder })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, board.id));
  const next = rows.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

  await db.insert(schema.boardRow).values({
    boardId: board.id,
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
  vehicleKind?: VehicleKind;
  validFrom?: string | null;
  validTo?: string | null;
}): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, input.boardSlug);
  const rowId = await rowOnBoard(board.id, input.rowId);
  if (input.groupId) await groupOnBoard(board.id, input.groupId);
  const db = getDb();

  const patch = plocka(input, [
    "label",
    "sublabel",
    "groupId",
    "color",
    "defaultVehicleId",
    "vehicleKind",
    "validFrom",
    "validTo",
  ]);
  if (Object.keys(patch).length === 0) return;

  await db
    .update(schema.boardRow)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.boardRow.id, rowId));
  refresh(input.boardSlug);
}

/**
 * Avslutar en rad i stället för att radera den.
 *
 * En inställd linje ska inte ta sin historik med sig — passen som redan
 * körts finns kvar, raden slutar bara visas framåt.
 */
export async function endBoardRow(rowId: string, lastDate: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db
    .update(schema.boardRow)
    .set({ validTo: lastDate, updatedAt: new Date() })
    .where(eq(schema.boardRow.id, await rowOnBoard(board.id, rowId)));
  refresh(boardSlug);
}

export async function deleteBoardRow(rowId: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db.delete(schema.boardRow).where(eq(schema.boardRow.id, await rowOnBoard(board.id, rowId)));
  refresh(boardSlug);
}

/** Sätter radernas ordning efter att de dragits om. */
export async function reorderBoardRows(rowIds: string[], boardSlug: string): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  for (const [i, id] of (await rowsOnBoard(board.id, rowIds)).entries()) {
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
  /* boardId kommer från klienten men används inte: tavlan är den vi
     kontrollerat, och dess id är det enda som skrivs. */
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  const groups = await db
    .select({ sortOrder: schema.boardGroup.sortOrder })
    .from(schema.boardGroup)
    .where(eq(schema.boardGroup.boardId, board.id));
  const next = groups.reduce((max, g) => Math.max(max, g.sortOrder), -1) + 1;

  await db
    .insert(schema.boardGroup)
    .values({ boardId: board.id, label: label.trim() || "Ny grupp", sortOrder: next });
  refresh(boardSlug);
}

export async function renameBoardGroup(
  groupId: string,
  label: string,
  boardSlug: string,
): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db
    .update(schema.boardGroup)
    .set({ label: label.trim() || "Ny grupp" })
    .where(eq(schema.boardGroup.id, await groupOnBoard(board.id, groupId)));
  refresh(boardSlug);
}

/** Tar bort en grupprubrik. Raderna blir kvar, utan gruppering. */
export async function deleteBoardGroup(groupId: string, boardSlug: string): Promise<void> {
  const user = await requireUser();
  const board = await boardForAction(user, boardSlug);
  const db = getDb();
  await db
    .delete(schema.boardGroup)
    .where(eq(schema.boardGroup.id, await groupOnBoard(board.id, groupId)));
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
  /* Frånvaro hör till personen och inte till tavlan, men den som bara
     har en tavla ska ändå inte kunna sjukskriva vem som helst i
     bolaget. Bemanningen är den koppling som finns. */
  const board = await boardForAction(user, input.boardSlug);
  await employeeOnBoard(board.id, input.employeeId);
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
  const board = await boardForAction(user, input.boardSlug);
  await employeeOnBoard(board.id, input.employeeId);
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
  const board = await boardForAction(user, boardSlug);
  const db = getDb();

  /* Frånvaron nås via personen: bara den som står i tavlans bemanning
     får sin status ändrad härifrån. */
  const [rad] = await db
    .select({ employeeId: schema.absence.employeeId })
    .from(schema.absence)
    .where(eq(schema.absence.id, absenceId));
  if (!rad) return;
  await employeeOnBoard(board.id, rad.employeeId);

  await db
    .update(schema.absence)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.absence.id, absenceId));
  refresh(boardSlug);
}
