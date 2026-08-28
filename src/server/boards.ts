import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import type { CurrentUser } from "./auth";

export type BoardResult = { ok: true; slug: string } | { ok: false; error: string };

/** De två utgångslägena. Allt går att ändra efteråt i tavelredigeraren. */
export type BoardTemplate = "fjarr" | "distribution";

interface Template {
  weekStartsOn: number;
  visibleWeekdays: number[];
  visibleShifts: string[];
  cellFields: string[];
  rows: Array<{ label: string; sublabel?: string }>;
}

/**
 * Bas-layouterna.
 *
 * Fjärr kör dygnet runt och veckan inleds med söndagen, precis som
 * fjärrbladen. Distribution går dagtid måndag–fredag. Raderna är bara
 * en start så tavlan inte öppnas tom — de byter namn, ordning och antal
 * i tavelredigeraren.
 */
const TEMPLATES: Record<BoardTemplate, Template> = {
  fjarr: {
    weekStartsOn: 0,
    visibleWeekdays: [0, 1, 2, 3, 4, 5],
    visibleShifts: ["day", "night"],
    cellFields: ["driver", "vehicle", "note"],
    rows: [{ label: "Bil 1" }, { label: "Bil 2" }, { label: "Bil 3" }, { label: "Bil 4" }],
  },
  distribution: {
    weekStartsOn: 1,
    visibleWeekdays: [1, 2, 3, 4, 5],
    visibleShifts: ["day"],
    cellFields: ["driver", "vehicle"],
    rows: [{ label: "Tur 1" }, { label: "Tur 2" }, { label: "Tur 3" }, { label: "Tur 4" }],
  },
};

export const TEMPLATE_LABELS: Array<{ id: BoardTemplate; name: string; description: string }> = [
  {
    id: "fjarr",
    name: "Fjärr",
    description: "Söndag–fredag, dag och natt, rader för bilar.",
  },
  {
    id: "distribution",
    name: "Distribution",
    description: "Måndag–fredag, bara dagpass, rader för turer.",
  },
];

/**
 * Skapar en tavla.
 *
 * En planerare som skapar en tavla blir också ägare och medlem — annars
 * skulle hen inte se den hen just skapat, eftersom planerare bara når
 * tavlor de fått tillgång till.
 */
export async function createBoard(
  user: CurrentUser,
  input: { name: string; template: BoardTemplate },
): Promise<BoardResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Tavlan behöver ett namn." };
  if (name.length > 80) return { ok: false, error: "Namnet får vara högst 80 tecken." };

  const template = TEMPLATES[input.template];
  if (!template) return { ok: false, error: "Okänd layout." };

  const db = getDb();
  const existing = await db.select({ slug: schema.board.slug }).from(schema.board);
  const slug = uniqueSlug(slugify(name), existing.map((b) => b.slug));

  const [board] = await db
    .insert(schema.board)
    .values({
      name,
      slug,
      ownerId: user.id,
      weekStartsOn: template.weekStartsOn,
      visibleWeekdays: template.visibleWeekdays,
      visibleShifts: template.visibleShifts,
      cellFields: template.cellFields,
      sortOrder: existing.length,
    })
    .returning();

  await db.insert(schema.boardRow).values(
    template.rows.map((row, i) => ({
      boardId: board.id,
      label: row.label,
      sublabel: row.sublabel ?? null,
      sortOrder: i,
    })),
  );

  if (user.role !== "admin") {
    await db
      .insert(schema.boardMember)
      .values({ boardId: board.id, userId: user.id, role: "editor" })
      .onConflictDoNothing();
  }

  return { ok: true, slug };
}

/** Vad en borttagning skulle kosta — för att kunna fråga innan, inte efter. */
export interface BoardRemovalFacts {
  rows: number;
  assignments: number;
  crew: number;
  baseSchedule: number;
}

/**
 * Räknar vad som följer med en tavla i graven.
 *
 * Finns för att bekräftelsedialogen ska kunna säga vad som faktiskt
 * försvinner. "Alla utlagda pass" kan vara noll eller femtusen, och
 * skillnaden avgör om man ska tveka.
 */
export async function boardRemovalFacts(boardId: string): Promise<BoardRemovalFacts> {
  const db = getDb();
  // En fråga i taget — se kommentaren i board-week.ts.
  const rows = await db
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, boardId));
  const crew = await db
    .select({ id: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, boardId));
  const baseRows = await db
    .select({ id: schema.baseSchedule.id })
    .from(schema.baseSchedule)
    .where(eq(schema.baseSchedule.boardId, boardId));

  const rowIds = rows.map((r) => r.id);
  const assignments = rowIds.length
    ? await db
        .select({ id: schema.assignment.id })
        .from(schema.assignment)
        .where(inArray(schema.assignment.boardRowId, rowIds))
    : [];

  return {
    rows: rows.length,
    assignments: assignments.length,
    crew: crew.length,
    baseSchedule: baseRows.length,
  };
}

/**
 * Tar bort en tavla med allt som hänger på den.
 *
 * Raderna, passen, bemanningen och bas-schemat följer med genom
 * cascade. Personal, fordon, hämtade pass och registrerad frånvaro
 * ligger utanför tavlan och rörs inte — frånvaron hör till personen,
 * inte till den tavla hen råkade stå på.
 */
export async function deleteBoard(boardId: string): Promise<void> {
  await getDb().delete(schema.board).where(eq(schema.board.id, boardId));
}

export interface WeekClearFacts {
  /** Pass som skulle försvinna, totalt. */
  assignments: number;
  /** Av dem: sådana någon lagt eller flyttat för hand. */
  manual: number;
  /** Spannet som rensas, för att bekräftelsen ska kunna säga vilket. */
  from: string;
  to: string;
}

/**
 * Räknar vad en veckorensning skulle ta med sig.
 *
 * Handpålagda pass räknas för sig. Ett automatgenererat pass kommer
 * tillbaka med nästa "Fyll veckan"; en handpåläggning gör det inte, och
 * det är den skillnaden som avgör om man ska tveka.
 */
export async function weekClearFacts(
  boardId: string,
  from: string,
  to: string,
  /** Egen koppling när funktionen körs utanför webbappen, t.ex. i test. */
  dbOverride?: Db,
): Promise<WeekClearFacts> {
  const db = dbOverride ?? getDb();
  const rows = await db
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, boardId));

  const rowIds = rows.map((r) => r.id);
  const assignments = rowIds.length
    ? await db
        .select({ source: schema.assignment.source })
        .from(schema.assignment)
        .where(
          and(
            inArray(schema.assignment.boardRowId, rowIds),
            gte(schema.assignment.date, from),
            lte(schema.assignment.date, to),
          ),
        )
    : [];

  return {
    assignments: assignments.length,
    manual: assignments.filter((a) => a.source === "manual").length,
    from,
    to,
  };
}

/**
 * Tömmer en tavlas vecka på pass.
 *
 * Avgränsat till tavlans egna rader och till spannet — inget annat rörs.
 * Bemanningen, bas-schemat och de hämtade passen står kvar, så veckan
 * går att fylla igen direkt.
 */
export async function clearWeekAssignments(
  boardId: string,
  from: string,
  to: string,
  dbOverride?: Db,
): Promise<number> {
  const db = dbOverride ?? getDb();
  const rows = await db
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, boardId));
  if (rows.length === 0) return 0;

  const removed = await db
    .delete(schema.assignment)
    .where(
      and(
        inArray(
          schema.assignment.boardRowId,
          rows.map((r) => r.id),
        ),
        gte(schema.assignment.date, from),
        lte(schema.assignment.date, to),
      ),
    )
    .returning({ id: schema.assignment.id });

  return removed.length;
}

export interface CrewRemovalFacts {
  /** Bas-schemarader som kopplar personen till en rad på tavlan. */
  baseSchedule: number;
  /** Utlagda pass personen har kvar på tavlan, oavsett vecka. */
  assignments: number;
}

/**
 * Vad som hänger på en person på just den här tavlan.
 *
 * Kopplingarna följer med när hen tas bort ur bemanningen — de betyder
 * ingenting utan henne. Passen gör det inte: de är utfört eller planerat
 * arbete, och att radera dem för att någon ska bort ur en lista vore att
 * kasta något annat än det man bad om.
 */
export async function crewRemovalFacts(
  boardId: string,
  employeeId: string,
  dbOverride?: Db,
): Promise<CrewRemovalFacts> {
  const db = dbOverride ?? getDb();

  const base = await db
    .select({ id: schema.baseSchedule.id })
    .from(schema.baseSchedule)
    .where(
      and(
        eq(schema.baseSchedule.boardId, boardId),
        eq(schema.baseSchedule.employeeId, employeeId),
      ),
    );

  const rows = await db
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, boardId));

  const assignments = rows.length
    ? await db
        .select({ id: schema.assignment.id })
        .from(schema.assignment)
        .where(
          and(
            inArray(
              schema.assignment.boardRowId,
              rows.map((r) => r.id),
            ),
            eq(schema.assignment.employeeId, employeeId),
          ),
        )
    : [];

  return { baseSchedule: base.length, assignments: assignments.length };
}

/**
 * Kopplar bort en person från en tavla.
 *
 * Bemanningen och bas-schemat på den här tavlan försvinner. Personen
 * själv rörs inte — hen hör till registret, inte till tavlan — och
 * hennes utlagda pass står kvar. Ett pass är planerat arbete; det ska
 * tas bort medvetet, inte som bieffekt av att någon städar en lista.
 */
export async function removeFromCrew(
  boardId: string,
  employeeId: string,
  dbOverride?: Db,
): Promise<void> {
  const db = dbOverride ?? getDb();

  await db
    .delete(schema.baseSchedule)
    .where(
      and(
        eq(schema.baseSchedule.boardId, boardId),
        eq(schema.baseSchedule.employeeId, employeeId),
      ),
    );
  await db
    .delete(schema.boardCrew)
    .where(
      and(eq(schema.boardCrew.boardId, boardId), eq(schema.boardCrew.employeeId, employeeId)),
    );
}
