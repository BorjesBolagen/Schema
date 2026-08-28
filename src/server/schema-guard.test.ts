import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { MIGRATIONS } from "@/db/migrations-manifest";
import { isSchemaOutOfDate, pendingMigrations, schemaStatusFor } from "./schema-guard";

/**
 * Vakten mot att koden är utrullad före migrationen.
 *
 * Det har hänt två gånger i drift, och båda gångerna såg det likadant
 * ut: `column "..." does not exist`, en stackspårning, och en sida som
 * fungerade minuten innan. Felet är sant men säger ingenting om att
 * svaret är att köra uppsättningsfilen.
 */

let db: Db;

beforeAll(async () => {
  db = createDb("memory://");
  await runMigrations(db);
});

afterAll(async () => closeDb(db));

describe("manifestet", () => {
  /* Manifestet genereras ur journalen. Skiljer de sig åt pekar vakten ut
     fel migration, vilket är sämre än ingen vakt alls. */
  it("stämmer med journalen", async () => {
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(MIGRATIONS.map((m) => m.tag)).toEqual(journal.entries.map((e) => e.tag));
  });

  /* Hashen måste vara den drizzles egen migrator räknar fram — hela
     filen, brytpunktsmarkörerna inräknade. Räknade vi den på något
     annat sätt skulle vakten peka ut migrationer som redan är körda och
     visa en varningssida när ingenting var fel. Det var precis vad som
     hände: generatorn strippade markörerna först. */
  it("hashar hela filen, som drizzle gör", async () => {
    for (const m of MIGRATIONS) {
      const rå = await readFile(`drizzle/${m.tag}.sql`, "utf8");
      expect([m.tag, createHash("sha256").update(rå).digest("hex")]).toEqual([m.tag, m.hash]);
    }
  });
});

describe("isSchemaOutOfDate", () => {
  it("känner igen en kolumn som inte finns", () => {
    expect(isSchemaOutOfDate({ code: "42703" })).toBe(true);
  });

  it("känner igen en tabell som inte finns", () => {
    expect(isSchemaOutOfDate({ code: "42P01" })).toBe(true);
  });

  /* Drivrutinen lägger felet under cause, så koden ligger ett steg ned —
     det var precis så det såg ut i drift. */
  it("hittar koden när den ligger under cause", () => {
    const error = Object.assign(new Error("Failed query: select ..."), {
      cause: { code: "42703", message: 'column "cycle_length" does not exist' },
    });
    expect(isSchemaOutOfDate(error)).toBe(true);
  });

  it("tar inte andra fel för schemafel", () => {
    expect(isSchemaOutOfDate(new Error("timeout"))).toBe(false);
    expect(isSchemaOutOfDate({ code: "23505" })).toBe(false); // unik nyckel
    expect(isSchemaOutOfDate(null)).toBe(false);
    expect(isSchemaOutOfDate(undefined)).toBe(false);
  });

  it("går inte i loop på ett cirkulärt fel", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(isSchemaOutOfDate(a)).toBe(false);
  });
});

describe("pendingMigrations", () => {
  it("säger att inget fattas när allt är kört", async () => {
    const { ok, pending } = await pendingMigrations(db);
    expect(ok).toBe(true);
    expect(pending).toEqual([]);
  });

  /* Johans läge: databasen står kvar på en äldre migration medan koden
     redan räknar med den nya kolumnen. */
  it("namnger den migration databasen saknar", async () => {
    const bakat = createDb("memory://");
    await runMigrations(bakat);
    await bakat.execute(
      sql`delete from drizzle."__drizzle_migrations" where hash = ${MIGRATIONS.at(-1)!.hash}`,
    );

    const { ok, pending } = await pendingMigrations(bakat);
    expect(ok).toBe(true);
    expect(pending).toEqual([MIGRATIONS.at(-1)!.tag]);
    await closeDb(bakat);
  });

  it("säger ifrån när frågan inte gick att ställa", async () => {
    const tom = createDb("memory://"); // inga migrationer alls
    const { ok, pending } = await pendingMigrations(tom);
    expect(ok).toBe(false);
    expect(pending).toEqual([]);
    await closeDb(tom);
  });
});

describe("schemaStatusFor", () => {
  it("ger null för fel som inte handlar om schemat", async () => {
    expect(await schemaStatusFor(new Error("nätet dog"))).toBeNull();
  });
});
