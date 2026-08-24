import "server-only";
import { asc, eq, ne } from "drizzle-orm";
import { getDb, schema, readWithTimeout } from "@/db";
import { hashPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/password-rules";

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "planner";
  isActive: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  /** Tavlor användaren har tillgång till. Tom lista = alla, för admin. */
  boardIds: string[];
}

export async function listUsers(): Promise<ManagedUser[]> {
  const { users, members } = await readWithTimeout(async () => {
    // Seriellt, inte parallellt — se kommentaren i board-week.ts.
    const db = getDb();
    const users = await db.select().from(schema.appUser).orderBy(asc(schema.appUser.name));
    const members = await db.select().from(schema.boardMember);
    return { users, members };
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    lockedUntil: u.lockedUntil,
    boardIds: members.filter((m) => m.userId === u.id).map((m) => m.boardId),
  }));
}

export type UserResult = { ok: true; id?: string } | { ok: false; error: string };

export async function createUser(input: {
  email: string;
  name: string;
  role: "admin" | "planner";
  password: string;
  boardIds: string[];
}): Promise<UserResult> {
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Ange en giltig e-postadress." };

  const db = getDb();
  const [existing] = await db.select().from(schema.appUser).where(eq(schema.appUser.email, email));
  if (existing) return { ok: false, error: "Det finns redan ett konto med den adressen." };

  const [user] = await db
    .insert(schema.appUser)
    .values({
      email,
      name: input.name.trim() || email,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    })
    .returning();

  await setBoardAccess(user.id, input.boardIds);
  return { ok: true, id: user.id };
}

/**
 * Vilka tavlor en användare når.
 *
 * Admin når alla oavsett, så listan gäller planerare. Tom lista för en
 * planerare betyder ingen tavla alls — inte alla.
 */
export async function setBoardAccess(userId: string, boardIds: string[]): Promise<void> {
  const db = getDb();
  await db.delete(schema.boardMember).where(eq(schema.boardMember.userId, userId));
  if (boardIds.length) {
    await db
      .insert(schema.boardMember)
      .values(boardIds.map((boardId) => ({ boardId, userId, role: "editor" as const })));
  }
}

export async function setPassword(userId: string, password: string): Promise<UserResult> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  await getDb()
    .update(schema.appUser)
    .set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null })
    .where(eq(schema.appUser.id, userId));
  return { ok: true };
}

/**
 * Stänger av ett konto och river dess sessioner.
 *
 * Utan att sessionerna tas bort skulle en avstängd användare kunna
 * fortsätta arbeta i upp till trettio dagar på en redan utfärdad kaka.
 */
export async function setActive(userId: string, isActive: boolean): Promise<void> {
  const db = getDb();
  await db.update(schema.appUser).set({ isActive }).where(eq(schema.appUser.id, userId));
  if (!isActive) {
    await db.delete(schema.session).where(eq(schema.session.userId, userId));
  }
}

/** Antal aktiva administratörer utom den angivna. */
export async function otherActiveAdmins(exceptUserId: string): Promise<number> {
  const rows = await getDb()
    .select()
    .from(schema.appUser)
    .where(ne(schema.appUser.id, exceptUserId));
  return rows.filter((u) => u.role === "admin" && u.isActive).length;
}
