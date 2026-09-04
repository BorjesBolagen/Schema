import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, schema, readWithTimeout, type Db } from "@/db";
import { hashPassword, verifyPassword } from "@/lib/password";
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

export async function setPassword(
  userId: string,
  password: string,
  /**
   * Sessionen som ska överleva bytet, som hash.
   *
   * Utelämnad river alla — det är vad en administratör som byter någon
   * annans lösenord vill: sker bytet för att kontot kan vara kapat
   * hjälper det inte att lösenordet ändras om den som tagit sig in
   * sitter kvar på en giltig kaka i trettio dagar.
   *
   * Byter man sitt eget skickas den egna sessionen med, annars kastas
   * man ut i samma sekund man gjort rätt sak.
   */
  keepSessionHash?: string | null,
  dbOverride?: Db,
): Promise<UserResult> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const db = dbOverride ?? getDb();
  await db
    .update(schema.appUser)
    .set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null })
    .where(eq(schema.appUser.id, userId));

  await db
    .delete(schema.session)
    .where(
      keepSessionHash
        ? and(
            eq(schema.session.userId, userId),
            ne(schema.session.tokenHash, keepSessionHash),
          )
        : eq(schema.session.userId, userId),
    );
  return { ok: true };
}

/**
 * Byter sitt eget lösenord, mot uppvisande av det nuvarande.
 *
 * Bytet krävde tidigare bara en giltig session. Det gick an så länge
 * ett byte bara var ett byte — men sedan sessionerna rivs vid byte är
 * det något mer: den som kommit över en kaka kan sätta ett eget
 * lösenord, behålla sin egen session och kasta ut den rätta ägaren.
 * Kakan blev alltså en väg till kontot, inte bara till innehållet, och
 * det var min egen förra rättning som gjorde den vägen värd att gå.
 *
 * Det nuvarande lösenordet stänger den: en stulen session räcker inte
 * längre för att ta över kontot.
 *
 * Ingen spärräknare här. Den som frågar är redan inloggad, så det finns
 * inget konto att räkna upp — och en räknare vore i stället en väg att
 * låsa ute någon vars dator man lånat en stund.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionHash?: string | null,
  dbOverride?: Db,
): Promise<UserResult> {
  const db = dbOverride ?? getDb();
  const [user] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, userId));
  if (!user) return { ok: false, error: "Kontot finns inte." };

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, error: "Nuvarande lösenord stämmer inte." };
  }
  /* Prövas efter det nuvarande lösenordet, inte före: annars säger
     formuläret "för kort" till den som inte visat att kontot är hens. */
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };

  return setPassword(userId, newPassword, keepSessionHash, db);
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
