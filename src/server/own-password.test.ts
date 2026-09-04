import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { hashPassword, verifyPassword } from "@/lib/password";
import { changeOwnPassword } from "./users";

/**
 * Byte av eget lösenord kräver det nuvarande.
 *
 * Bytet krävde tidigare bara en giltig session. Det gick an så länge
 * ett byte bara var ett byte — men sedan sessionerna rivs vid byte är
 * det något mer: den som kommit över en kaka kan sätta ett eget
 * lösenord, behålla sin egen session och kasta ut ägaren. Kakan blev en
 * väg till kontot, inte bara till innehållet, och det var den förra
 * rättningen som gjorde vägen värd att gå.
 */

let db: Db;

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);
});

afterAll(async () => {
  if (db) await closeDb(db);
});

const NUVARANDE = "vagn-hjul-krita-9";
const NYTT = "torsdag-kaffe-hamn-4";

async function konto() {
  const [u] = await db
    .insert(schema.appUser)
    .values({
      email: "a@borjes.se",
      name: "A",
      role: "planner",
      passwordHash: await hashPassword(NUVARANDE),
    })
    .returning();
  return u;
}

/** Två sessioner: den man byter i, och en till som ska rivas. */
async function sessioner(userId: string) {
  const om30 = new Date(Date.now() + 30 * 86_400_000);
  await db.insert(schema.session).values([
    { tokenHash: "min", userId, expiresAt: om30 },
    { tokenHash: "annans", userId, expiresAt: om30 },
  ]);
}

const hashen = async (userId: string) =>
  (await db.select().from(schema.appUser).where(eq(schema.appUser.id, userId)))[0].passwordHash;

describe("byta eget lösenord", () => {
  it("byter när det nuvarande stämmer", async () => {
    const u = await konto();
    const result = await changeOwnPassword(u.id, NUVARANDE, NYTT, null, db);
    expect(result.ok).toBe(true);
    expect(await verifyPassword(NYTT, await hashen(u.id))).toBe(true);
  });

  it("nekar när det nuvarande är fel", async () => {
    const u = await konto();
    const result = await changeOwnPassword(u.id, "fel-lösenord-helt", NYTT, null, db);
    expect(result).toEqual({ ok: false, error: "Nuvarande lösenord stämmer inte." });
  });

  /* Det viktiga: ett nekat byte får inte lämna något efter sig. */
  it("lämnar lösenordet orört när det nuvarande är fel", async () => {
    const u = await konto();
    await changeOwnPassword(u.id, "fel-lösenord-helt", NYTT, null, db);
    expect(await verifyPassword(NUVARANDE, await hashen(u.id))).toBe(true);
    expect(await verifyPassword(NYTT, await hashen(u.id))).toBe(false);
  });

  it("river inga sessioner när det nuvarande är fel", async () => {
    const u = await konto();
    await sessioner(u.id);
    await changeOwnPassword(u.id, "fel-lösenord-helt", NYTT, "min", db);
    expect(await db.select().from(schema.session)).toHaveLength(2);
  });

  /* Utan den här ordningen skvallrar formuläret: "för kort" är ett svar
     på det nya lösenordet, och det ska ingen få innan hen visat att
     kontot är hens. */
  it("prövar det nuvarande före kraven på det nya", async () => {
    const u = await konto();
    const result = await changeOwnPassword(u.id, "fel-lösenord-helt", "kort", null, db);
    expect(result).toEqual({ ok: false, error: "Nuvarande lösenord stämmer inte." });
  });

  it("håller kvar kraven på det nya lösenordet", async () => {
    const u = await konto();
    const result = await changeOwnPassword(u.id, NUVARANDE, "kort", null, db);
    expect(result.ok).toBe(false);
    expect(await verifyPassword(NUVARANDE, await hashen(u.id))).toBe(true);
  });

  it("river de andra sessionerna men skonar den man byter i", async () => {
    const u = await konto();
    await sessioner(u.id);
    await changeOwnPassword(u.id, NUVARANDE, NYTT, "min", db);
    const kvar = await db.select().from(schema.session);
    expect(kvar.map((s) => s.tokenHash)).toEqual(["min"]);
  });

  it("säger ifrån om kontot inte finns", async () => {
    const result = await changeOwnPassword(
      "00000000-0000-0000-0000-000000000000",
      NUVARANDE,
      NYTT,
      null,
      db,
    );
    expect(result).toEqual({ ok: false, error: "Kontot finns inte." });
  });
});
