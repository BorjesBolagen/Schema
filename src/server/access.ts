import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema, readWithTimeout } from "@/db";
import type { CurrentUser } from "./auth";

/**
 * Vilka tavlor en användare når.
 *
 * Administratörer når alla. Planerare når dem de fått tillgång till —
 * och en planerare utan tilldelade tavlor når ingen, vilket är avsikten:
 * tillgång ska ges, inte ärvas.
 */
export async function visibleBoards(user: CurrentUser) {
  return readWithTimeout(async () => {
    const db = getDb();
    if (user.role === "admin") {
      return db
        .select()
        .from(schema.board)
        .orderBy(asc(schema.board.sortOrder), asc(schema.board.name));
    }

    const memberships = await db
      .select()
      .from(schema.boardMember)
      .where(eq(schema.boardMember.userId, user.id));
    if (memberships.length === 0) return [];

    return db
      .select()
      .from(schema.board)
      .where(inArray(schema.board.id, memberships.map((m) => m.boardId)))
      .orderBy(asc(schema.board.sortOrder), asc(schema.board.name));
  });
}

export async function canAccessBoard(user: CurrentUser, boardId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const rows = await readWithTimeout(() =>
    getDb().select().from(schema.boardMember).where(eq(schema.boardMember.userId, user.id)),
  );
  return rows.some((m) => m.boardId === boardId);
}

/**
 * Kräver åtkomst till en tavla via dess slug.
 *
 * Svarar med "finns inte" i stället för "inte behörig" — annars går
 * sidan att använda för att ta reda på vilka tavlor som finns.
 */
export async function requireBoardBySlug(user: CurrentUser, slug: string) {
  const [board] = await readWithTimeout(() =>
    getDb().select().from(schema.board).where(eq(schema.board.slug, slug)),
  );
  if (!board || !(await canAccessBoard(user, board.id))) notFound();
  return board;
}

export async function requireBoardById(user: CurrentUser, boardId: string) {
  const db = getDb();
  const [board] = await db.select().from(schema.board).where(eq(schema.board.id, boardId));
  if (!board || !(await canAccessBoard(user, board.id))) notFound();
  return board;
}

/** Som requireBoardBySlug, men returnerar ett svar i stället för att kasta. */
export async function canAccessBoardBySlug(user: CurrentUser, slug: string): Promise<boolean> {
  const [board] = await getDb().select().from(schema.board).where(eq(schema.board.slug, slug));
  return !!board && (await canAccessBoard(user, board.id));
}

/**
 * Hämtar tavlan efter behörighetskontroll på dess slug.
 *
 * Här låg assertBoardAccess, som tog emot antingen en slug eller ett id
 * och svarade ja eller nej — men lämnade anroparen att skriva till
 * vilket id som helst efteråt. Det glappet gjorde nitton actions
 * åtkomliga från fel tavla.
 *
 * Den här returnerar tavlan man faktiskt fick tillgång till, så
 * skrivningen använder dess id och inte klientens. Då finns ingenting
 * att gå isär.
 *
 * Kastar i stället för att omdirigera — en action har ingen sida att
 * skicka någon vidare till.
 */
export async function boardForAction(user: CurrentUser, slug: string) {
  const [board] = await getDb().select().from(schema.board).where(eq(schema.board.slug, slug));
  if (!board || !(await canAccessBoard(user, board.id))) {
    throw new Error("Du har inte tillgång till den här tavlan.");
  }
  return board;
}

