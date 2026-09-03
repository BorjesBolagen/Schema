import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { hashPassword } from "@/lib/password";

/**
 * Ett lösenordsbyte ska riva sessionerna.
 *
 * setActive gjorde det redan — en avstängd användare skulle annars kunna
 * arbeta vidare i trettio dagar på en redan utfärdad kaka. Men
 * setPassword gjorde det inte, och det är samma sak: byter man lösenord
 * för att någon kan ha kommit över det hjälper inte bytet om den som
 * tagit sig in sitter kvar på sin session.
 *
 * Undantaget är den session bytet görs i. Annars kastas man ut i samma
 * sekund man gjort rätt sak, och det lär folk att inte byta.
 *
 * setPassword importeras dynamiskt: modulen är server-only och testet
 * kör utanför Next, så importen måste ske när miljön är satt.
 */

let db: Db;
let anna: string;

const sessionerFör = async (userId: string) =>
  (
    await db
      .select({ hash: schema.session.tokenHash })
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
  ).map((s) => s.hash);

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);

  const [u] = await db
    .insert(schema.appUser)
    .values({
      email: "anna@example.se",
      name: "Anna",
      role: "planner",
      passwordHash: await hashPassword("gammalt-lösenord"),
    })
    .returning();
  anna = u.id;

  const om30 = new Date(Date.now() + 30 * 86_400_000);
  await db.insert(schema.session).values([
    { tokenHash: "min-egen", userId: anna, expiresAt: om30 },
    { tokenHash: "mobilen", userId: anna, expiresAt: om30 },
    { tokenHash: "nagon-annans", userId: anna, expiresAt: om30 },
  ]);
});

afterAll(async () => {
  if (db) await closeDb(db);
});

describe("setPassword", () => {
  it("river alla sessioner när ingen ska skonas", async () => {
    const { setPassword } = await import("./users");
    /* Administratörens läge: byter någon annans lösenord, och då ska
       ingen av deras sessioner överleva. */
    const ut = await setPassword(anna, "ett-nytt-långt-lösenord", null, db);
    expect(ut.ok).toBe(true);
    expect(await sessionerFör(anna)).toEqual([]);
  });

  it("skonar den session bytet görs i", async () => {
    const { setPassword } = await import("./users");
    const ut = await setPassword(anna, "ett-nytt-långt-lösenord", "min-egen", db);
    expect(ut.ok).toBe(true);
    expect(await sessionerFör(anna)).toEqual(["min-egen"]);
  });

  /* Ett avvisat lösenord ska inte heller logga ut någon: ingenting
     ändrades, så ingenting ska rivas. */
  it("rör inga sessioner när lösenordet inte godtas", async () => {
    const { setPassword } = await import("./users");
    const ut = await setPassword(anna, "kort", "min-egen", db);
    expect(ut.ok).toBe(false);
    expect((await sessionerFör(anna)).sort()).toEqual(["min-egen", "mobilen", "nagon-annans"]);
  });
});
