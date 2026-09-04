import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema, readWithTimeout, type Db } from "@/db";
import type { CurrentUser } from "./auth";

/**
 * Att kontrollera samma sak som man skriver.
 *
 * Server-actions tog emot både en slug och ett id från samma
 * klientanrop, kontrollerade behörigheten på slugen och skrev till id:t
 * — två olika saker som ingenting band ihop. En planerare med tillgång
 * till sin egen tavla kunde skicka sin slug tillsammans med någon
 * annans rad-, pass- eller tavel-id och skriva där. Typen i TypeScript
 * hindrade ingenting: på andra sidan är anropet bara JSON.
 *
 * Funktionerna här hämtar id:t *genom* tavlan. Finns det inte där finns
 * ingenting att skriva till.
 *
 * Ligger skilt från access.ts, som drar in next/navigation och därmed
 * React — en modul som inte går att testa utan att starta en renderare.
 * Det här är frågor mot databasen, inget annat.
 */

/** Kastas när ett id pekar utanför den tavla man har tillgång till. */
class NotOnBoardError extends Error {
  constructor(vad: string) {
    /* Samma text oavsett om raden inte finns eller ligger på någon
       annans tavla. Skillnaden vore i sig en upplysning om vad som
       finns. */
    super(`${vad} hör inte till den här tavlan.`);
    this.name = "NotOnBoardError";
  }
}

/** Radens id, men bara om raden ligger på tavlan. */
export async function rowOnBoard(
  boardId: string,
  rowId: string,
  dbOverride?: Db,
): Promise<string> {
  const [row] = await (dbOverride ?? getDb())
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(and(eq(schema.boardRow.id, rowId), eq(schema.boardRow.boardId, boardId)));
  if (!row) throw new NotOnBoardError("Raden");
  return row.id;
}

/**
 * Som rowOnBoard, för flera rader på en gång.
 *
 * Alla prövas innan någon används. Ett främmande id mitt i en omordning
 * skulle annars hinna flytta om halva tavlan innan det upptäcktes.
 */
export async function rowsOnBoard(
  boardId: string,
  rowIds: string[],
  dbOverride?: Db,
): Promise<string[]> {
  if (rowIds.length === 0) return [];
  const rows = await (dbOverride ?? getDb())
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(and(inArray(schema.boardRow.id, rowIds), eq(schema.boardRow.boardId, boardId)));
  if (rows.length !== new Set(rowIds).size) throw new NotOnBoardError("Raderna");
  return rowIds;
}

/**
 * Passets id, men bara om passet ligger på en av tavlans rader.
 *
 * Passet bär ingen tavla själv — vägen dit går via raden, och det är
 * just därför kontrollen var lätt att glömma.
 */
export async function assignmentOnBoard(
  boardId: string,
  assignmentId: string,
  dbOverride?: Db,
): Promise<string> {
  const [a] = await (dbOverride ?? getDb())
    .select({ id: schema.assignment.id })
    .from(schema.assignment)
    .innerJoin(schema.boardRow, eq(schema.boardRow.id, schema.assignment.boardRowId))
    .where(and(eq(schema.assignment.id, assignmentId), eq(schema.boardRow.boardId, boardId)));
  if (!a) throw new NotOnBoardError("Passet");
  return a.id;
}

/** Grupprubrikens id, men bara om den ligger på tavlan. */
export async function groupOnBoard(
  boardId: string,
  groupId: string,
  dbOverride?: Db,
): Promise<string> {
  const [g] = await (dbOverride ?? getDb())
    .select({ id: schema.boardGroup.id })
    .from(schema.boardGroup)
    .where(and(eq(schema.boardGroup.id, groupId), eq(schema.boardGroup.boardId, boardId)));
  if (!g) throw new NotOnBoardError("Gruppen");
  return g.id;
}

/**
 * Personens id, men bara om hen står i tavlans bemanning.
 *
 * Frånvaro hör till personen och inte till tavlan, men den som bara har
 * en tavla ska ändå inte kunna sjukskriva vem som helst i bolaget.
 * Bemanningen är den koppling som finns, och den duger som gräns.
 */
export async function employeeOnBoard(
  boardId: string,
  employeeId: string,
  dbOverride?: Db,
): Promise<string> {
  const [c] = await (dbOverride ?? getDb())
    .select({ employeeId: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(
      and(eq(schema.boardCrew.boardId, boardId), eq(schema.boardCrew.employeeId, employeeId)),
    );
  if (!c) throw new NotOnBoardError("Personen");
  return c.employeeId;
}

export async function canAccessBoard(
  user: CurrentUser,
  boardId: string,
  dbOverride?: Db,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const rows = await readWithTimeout(
    () =>
      (dbOverride ?? getDb())
        .select()
        .from(schema.boardMember)
        .where(eq(schema.boardMember.userId, user.id)),
    undefined,
    dbOverride,
  );
  return rows.some((m) => m.boardId === boardId);
}

/**
 * Får användaren *ändra* tavlan, inte bara se den?
 *
 * board_member.role har funnits sedan första migrationen med värdena
 * editor och viewer, men ingenting läste den: alla med tillgång kunde
 * ändra allt. Det var inget hål så länge ingen kunde bli viewer — men
 * fältet såg ut som en spärr, och den som en dag satt role='viewer' i
 * databasen hade fått fulla rättigheter i tro att hen gett läsrätt.
 *
 * Ett fält som finns, tar emot ett värde och inte gör något är värre än
 * ett som saknas. Nu betyder det något.
 */
/**
 * Vilka av tavlorna användaren får ändra.
 *
 * Finns för listor. canEditBoard frågar databasen en gång per tavla,
 * och en startsida med tio tavlor skulle alltså ställa tio frågor för
 * att avgöra vilka knappar som ska ritas. Medlemskapen hämtas i stället
 * en gång.
 *
 * "alla" för administratörer — de går förbi medlemskapet, och en lista
 * över allt vore bara ett sämre sätt att säga samma sak.
 */
export async function editableBoardIds(
  user: CurrentUser,
  dbOverride?: Db,
): Promise<Set<string> | "alla"> {
  if (user.role === "admin") return "alla";
  const rows = await readWithTimeout(
    () =>
      (dbOverride ?? getDb())
        .select()
        .from(schema.boardMember)
        .where(eq(schema.boardMember.userId, user.id)),
    undefined,
    dbOverride,
  );
  return new Set(rows.filter((m) => m.role === "editor").map((m) => m.boardId));
}

export async function canEditBoard(
  user: CurrentUser,
  boardId: string,
  dbOverride?: Db,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const rows = await readWithTimeout(
    () =>
      (dbOverride ?? getDb())
        .select()
        .from(schema.boardMember)
        .where(eq(schema.boardMember.userId, user.id)),
    undefined,
    dbOverride,
  );
  return rows.some((m) => m.boardId === boardId && m.role === "editor");
}
