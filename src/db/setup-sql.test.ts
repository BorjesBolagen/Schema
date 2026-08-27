import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { makeIdempotent, statementsOf } from "../../scripts/build-setup-sql";

/**
 * docs/supabase-setup.sql klistras in i Supabases SQL-editor för hand.
 * Det finns ingen migrationsmotor på andra sidan som vet vad som redan
 * körts — bara en textruta och en knapp. Alltså måste filen tåla att
 * köras mot en databas som redan är migrerad en bit, och det går bara
 * att veta genom att göra det.
 *
 * Precis det felet dök upp i skarpt läge: "type absence_status already
 * exists" mot en databas som redan hade de fyra första migrationerna.
 */

const setupSql = async () => readFile("docs/supabase-setup.sql", "utf8");

/** PGlite kör hela filen som ett skript, precis som Supabases editor gör. */
async function run(db: PGlite, sql: string) {
  await db.exec(sql);
}

const tableNames = async (db: PGlite) =>
  (
    await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    )
  ).rows.map((r) => r.table_name);

describe("docs/supabase-setup.sql", () => {
  it("sätter upp en tom databas", async () => {
    const db = new PGlite();
    await run(db, await setupSql());

    const tables = await tableNames(db);
    expect(tables).toContain("employee");
    expect(tables).toContain("transpa_shift");
    // Mönstertabellerna droppas av 0005 och ska inte finnas kvar.
    expect(tables).not.toContain("work_pattern");
    await db.close();
  });

  it("går att köra om mot en databas som redan är uppsatt", async () => {
    const db = new PGlite();
    const sql = await setupSql();
    await run(db, sql);
    await run(db, sql);

    expect(await tableNames(db)).toContain("transpa_shift");
    await db.close();
  });

  /* Johans läge: fyra migrationer pålagda för länge sedan, och nu ska
     resten på utan att någon vet var gränsen går. */
  it("lägger på det som fattas mot en databas som stannat vid 0003", async () => {
    const db = new PGlite();
    for (const tag of ["0000_init", "0001_legal_king_cobra", "0002_rls", "0003_profession_group"]) {
      for (const s of statementsOf(await readFile(`drizzle/${tag}.sql`, "utf8"))) {
        await db.exec(s);
      }
    }
    expect(await tableNames(db)).not.toContain("transpa_shift");

    await run(db, await setupSql());

    const tables = await tableNames(db);
    expect(tables).toContain("transpa_shift");
    expect(tables).not.toContain("work_pattern");
    expect(tables).not.toContain("work_pattern_day");
    await db.close();
  });

  it("markerar alla migrationer som körda, så db:migrate inte tar om dem", async () => {
    /* Antalet läses ur journalen i stället för att skrivas hit. En
       hårdkodad siffra betyder att varje ny migration gör testet rött
       av fel skäl, och den sortens rött lär man sig att klicka förbi. */
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      entries: unknown[];
    };

    const db = new PGlite();
    await run(db, await setupSql());
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from drizzle."__drizzle_migrations"',
    );
    expect(rows[0].n).toBe(journal.entries.length);
    await db.close();
  });
});

describe("makeIdempotent", () => {
  it("lägger IF NOT EXISTS på CREATE TABLE", () => {
    expect(makeIdempotent('CREATE TABLE "board" ("id" uuid)')).toBe(
      'CREATE TABLE IF NOT EXISTS "board" ("id" uuid)',
    );
  });

  it("rör inte en sats som redan har IF NOT EXISTS", () => {
    const sql = 'CREATE TABLE IF NOT EXISTS "board" ("id" uuid)';
    expect(makeIdempotent(sql)).toBe(sql);
  });

  it("lägger CREATE TYPE i ett block som bara fångar 'finns redan'", () => {
    const out = makeIdempotent(`CREATE TYPE "public"."shift" AS ENUM('day', 'night');`);
    expect(out).toContain("EXCEPTION WHEN duplicate_object THEN NULL;");
    expect(out).toContain("AS ENUM('day', 'night')");
  });

  /* Ett handskrivet DO-block kontrollerar sina egna villkor. Att lägga
     det i ytterligare ett vore att gissa om vad det gör. */
  it("rör inte ett DO-block som redan finns i migrationen", () => {
    const sql = "DO $$\nBEGIN\n  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;\nEND $$;";
    expect(makeIdempotent(sql)).toBe(sql);
  });

  it("låter RLS på en bortdroppad tabell passera i stället för att fälla", () => {
    const out = makeIdempotent('ALTER TABLE "work_pattern" ENABLE ROW LEVEL SECURITY;');
    expect(out).toContain("EXCEPTION WHEN undefined_table THEN NULL;");
  });

  it("lägger IF EXISTS på DROP CONSTRAINT och IF NOT EXISTS på ADD COLUMN", () => {
    expect(makeIdempotent('ALTER TABLE "employee" DROP CONSTRAINT "x";')).toContain(
      "DROP CONSTRAINT IF EXISTS",
    );
    expect(makeIdempotent('ALTER TABLE "employee" ADD COLUMN "x" uuid;')).toContain(
      "ADD COLUMN IF NOT EXISTS",
    );
  });
});
