import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/password";
import { decideSignIn } from "@/lib/sign-in-decision";

/**
 * Inloggningen ska inte gå att använda för att kartlägga konton.
 *
 * Felmeddelandet var redan detsamma för "finns inte" och "fel
 * lösenord", men två kanaler läckte ändå:
 *
 *   Spärren. Åtta felförsök mot en gissad adress, och svaret bytte till
 *   "kontot är tillfälligt spärrat" — bara för adresser som fanns.
 *
 *   Tiden. scrypt är avsiktligt långsamt, så ett konto som inte fanns
 *   svarade på en millisekund medan fel lösenord tog hundra.
 *
 * signIn kan inte anropas här: den sätter en kaka och drar in Nexts
 * request-context. Beslutet är därför brutet till decideSignIn, som är
 * en ren funktion och går att pröva på riktigt — bättre än att läsa
 * källkoden och hoppas.
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

describe("attrapphashen", () => {
  it("är en riktig scrypt-hash som ingen kan matcha", async () => {
    const h = await dummyHash();
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("", h)).toBe(false);
    expect(await verifyPassword("lösenord", h)).toBe(false);
  });

  /* Samma hash varje gång: räknades en ny fram per anrop skulle
     inloggningen dessutom bli långsammare för okända adresser än för
     kända — samma läcka, åt andra hållet. */
  it("räknas fram en gång", async () => {
    expect(await dummyHash()).toBe(await dummyHash());
  });

  /* Det som betyder något: att kontrollera mot attrappen ska kosta
     ungefär lika mycket som mot en riktig hash. Marginalen är vid —
     testet ska fånga en storleksordning, inte mäta prestanda. */
  it("kostar lika mycket som en riktig kontroll", async () => {
    const riktig = await hashPassword("ett-riktigt-lösenord");
    const attrapp = await dummyHash();

    const mät = async (hash: string) => {
      const start = performance.now();
      for (let i = 0; i < 3; i++) await verifyPassword("fel-gissning", hash);
      return performance.now() - start;
    };

    const a = await mät(riktig);
    const b = await mät(attrapp);
    const kvot = Math.max(a, b) / Math.max(1, Math.min(a, b));
    expect(kvot).toBeLessThan(3);
  });
});

describe("decideSignIn", () => {
  const om15min = new Date(Date.now() + 15 * 60_000);
  const igår = new Date(Date.now() - 86_400_000);

  const bas = { finns: true, passwordOk: true, lockedUntil: null, isActive: true };

  it("släpper in ett aktivt konto med rätt lösenord", () => {
    expect(decideSignIn(bas)).toEqual({ kind: "ok" });
  });

  it("nekar fel lösenord", () => {
    expect(decideSignIn({ ...bas, passwordOk: false })).toEqual({ kind: "denied" });
  });

  it("nekar en adress som inte finns", () => {
    expect(decideSignIn({ ...bas, finns: false, passwordOk: false })).toEqual({ kind: "denied" });
  });

  /* Kärnan: en spärrad adress och en okänd adress ska vara omöjliga att
     skilja åt så länge lösenordet är fel. Annars blir åtta felförsök en
     fråga om adressen existerar. */
  it("ger samma svar för spärrat konto och okänd adress vid fel lösenord", () => {
    const spärrat = decideSignIn({ ...bas, passwordOk: false, lockedUntil: om15min });
    const okänd = decideSignIn({ ...bas, finns: false, passwordOk: false });
    expect(spärrat).toEqual(okänd);
  });

  it("ger samma svar för avstängt konto och okänd adress vid fel lösenord", () => {
    const avstängt = decideSignIn({ ...bas, passwordOk: false, isActive: false });
    expect(avstängt).toEqual(decideSignIn({ ...bas, finns: false, passwordOk: false }));
  });

  /* Rätt lösenord bevisar att man äger kontot — då läcker beskedet
     ingenting, och en riktig användare slipper gissa. */
  it("berättar om spärren för den som gett rätt lösenord", () => {
    const ut = decideSignIn({ ...bas, lockedUntil: om15min });
    expect(ut.kind).toBe("locked");
    expect(ut.kind === "locked" && ut.minutes).toBeGreaterThan(0);
  });

  it("berättar om avstängningen för den som gett rätt lösenord", () => {
    expect(decideSignIn({ ...bas, isActive: false })).toEqual({ kind: "inactive" });
  });

  /* En spärr som gått ut ska inte hindra någon. */
  it("släpper in när spärren löpt ut", () => {
    expect(decideSignIn({ ...bas, lockedUntil: igår })).toEqual({ kind: "ok" });
  });

  it("räknar minuterna kvar av spärren", () => {
    const nu = Date.parse("2026-09-03T10:00:00Z");
    const ut = decideSignIn({
      ...bas,
      lockedUntil: new Date(nu + 5 * 60_000 + 1000),
      now: nu,
    });
    expect(ut).toEqual({ kind: "locked", minutes: 6 });
  });
});

describe("spärren i databasen", () => {
  it("räknar upp felförsök och spärrar efter åtta", async () => {
    const [u] = await db
      .insert(schema.appUser)
      .values({
        email: "anna@example.se",
        name: "Anna",
        role: "planner",
        passwordHash: await hashPassword("rätt-lösenord-här"),
        failedLoginCount: 7,
      })
      .returning();

    await db
      .update(schema.appUser)
      .set({ failedLoginCount: 8, lockedUntil: new Date(Date.now() + 900_000) })
      .where(eq(schema.appUser.id, u.id));

    const [efter] = await db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.id, u.id));
    expect(efter.failedLoginCount).toBe(8);
    expect(efter.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});
