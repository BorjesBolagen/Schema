import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
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
 * cascade. Personal, fordon, arbetsmönster och registrerad frånvaro
 * ligger utanför tavlan och rörs inte — frånvaron hör till personen,
 * inte till den tavla hen råkade stå på.
 */
export async function deleteBoard(boardId: string): Promise<void> {
  await getDb().delete(schema.board).where(eq(schema.board.id, boardId));
}
