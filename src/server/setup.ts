import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/password-rules";

/**
 * Första uppsättningen.
 *
 * Finns för att en ny databas ska gå att ta i bruk från webbläsaren i
 * stället för att någon kör ett skript mot produktionen. Rutten
 * fungerar bara så länge det inte finns en enda användare — därefter
 * går den inte att nå, och nya konton skapas av en admin.
 */
export async function needsSetup(): Promise<boolean> {
  const rows = await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.appUser);
  return (rows[0]?.n ?? 0) === 0;
}

export type SetupResult = { ok: true } | { ok: false; error: string };

export async function createFirstAdmin(
  email: string,
  name: string,
  password: string,
): Promise<SetupResult> {
  if (!(await needsSetup())) {
    return { ok: false, error: "Det finns redan konton. Be en administratör lägga upp ditt." };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  await getDb().insert(schema.appUser).values({
    email: email.trim().toLowerCase(),
    name: name.trim(),
    role: "admin",
    passwordHash: await hashPassword(password),
  });
  return { ok: true };
}
