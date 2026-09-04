import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, schema, readWithTimeout } from "@/db";
import { dummyHash, verifyPassword } from "@/lib/password";
import { decideSignIn } from "@/lib/sign-in-decision";

import { SESSION_COOKIE } from "./auth-cookie";

export { SESSION_COOKIE };
const SESSION_DAYS = 30;

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "planner";
}

/** Sessionstoken lagras bara som hash — se schema.session. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * @param remember Ska kakan ligga kvar när webbläsaren stängs?
 *
 * Sessionen i databasen lever trettio dagar oavsett — den är kvittot på
 * att inloggningen ägt rum, och att korta ner den hade bara flyttat
 * gränsen. Det som styrs här är kakans livslängd i webbläsaren: utan
 * expires blir den en sessionskaka och försvinner med fönstret. Sant är
 * förvalet, alltså precis det som gällde innan kryssrutan fanns.
 */
export async function createSession(userId: string, remember = true): Promise<void> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(schema.session).values({ tokenHash: hashToken(token), userId, expiresAt });
  await db
    .update(schema.appUser)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.appUser.id, userId));

  // Städa bort utgångna sessioner i samma veva; de fyller annars bara på.
  await db.delete(schema.session).where(lt(schema.session.expiresAt, new Date()));

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { expires: expiresAt } : {}),
  });
}

/**
 * Sessionshashen för den som är inloggad just nu, eller null.
 *
 * Finns för lösenordsbytet: alla *andra* sessioner ska rivas, men inte
 * den man byter lösenord i — annars kastas man ut i samma sekund man
 * gjort rätt sak.
 */
export async function currentSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb().delete(schema.session).where(eq(schema.session.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Den inloggade användaren, eller null.
 *
 * cache() gör att en sidrendering slår i databasen en gång även när
 * flera komponenter frågar. Bakom readWithTimeout: den körs på varenda
 * sida, så den får inte hänga kvar till plattformens egen gräns om
 * databaskopplingen skulle fastna.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await readWithTimeout(() =>
    getDb()
      .select({
        id: schema.appUser.id,
        email: schema.appUser.email,
        name: schema.appUser.name,
        role: schema.appUser.role,
        isActive: schema.appUser.isActive,
      })
      .from(schema.session)
      .innerJoin(schema.appUser, eq(schema.session.userId, schema.appUser.id))
      .where(
        and(eq(schema.session.tokenHash, hashToken(token)), gt(schema.session.expiresAt, new Date())),
      ),
  );

  const user = rows[0];
  if (!user || !user.isActive) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

/**
 * Kräver inloggning. Anropas i varje sida och server-action som rör
 * schemadata — mellanvaran skickar bara vidare till inloggningen och är
 * inte gränsen som håller.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Så många felförsök innan kontot spärras, och hur länge. */
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

const GENERIC = "Fel e-post eller lösenord.";

export async function signIn(
  email: string,
  password: string,
  remember = true,
): Promise<SignInResult> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.appUser)
    .where(eq(schema.appUser.email, email.trim().toLowerCase()));

  /* Lösenordet räknas alltid, även när kontot inte finns.
     scrypt är avsiktligt långsamt, så "finns inte" svarade på en
     millisekund medan "fel lösenord" tog hundra — och den skillnaden
     går att mäta utifrån. Då hjälper det inte att felmeddelandet är
     detsamma: klockan säger vilka adresser som är riktiga konton. */
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));

  const beslut = decideSignIn({
    finns: Boolean(user),
    passwordOk,
    lockedUntil: user?.lockedUntil ?? null,
    isActive: user?.isActive ?? false,
  });

  if (beslut.kind === "locked") {
    return {
      ok: false,
      error: `Kontot är tillfälligt spärrat efter flera felaktiga försök. Försök igen om ${beslut.minutes} min.`,
    };
  }
  if (beslut.kind === "inactive") {
    return { ok: false, error: "Kontot är avstängt. Kontakta en administratör." };
  }

  if (beslut.kind === "denied") {
    if (user) {
      const failed = user.failedLoginCount + 1;
      await db
        .update(schema.appUser)
        .set({
          failedLoginCount: failed,
          lockedUntil:
            failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(schema.appUser.id, user.id));
    }
    return { ok: false, error: GENERIC };
  }

  await db
    .update(schema.appUser)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(schema.appUser.id, user!.id));
  await createSession(user!.id, remember);
  return { ok: true };
}

