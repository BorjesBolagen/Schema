import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { makeIdempotent, ownTables, statementsOf } from "../../scripts/build-setup-sql";

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

/**
 * Vakten mot fel Supabase-projekt.
 *
 * Filen klistras in för hand, och SQL-editorn säger ingenting om vilket
 * projekt man har framme. Hamnar den fel skapas tjugo tabeller där de
 * inte hör hemma — och felet upptäcks först när någon undrar varför.
 *
 * Vakten måste därför stoppa i rätt fall och *inte* stoppa i de tre
 * lägen som är helt normala: tom databas, vår databas, och vår databas
 * en gång till.
 */
describe("vakten mot fel projekt", () => {
  const kör = async (db: PGlite) => run(db, await setupSql());

  it("släpper igenom en tom databas", async () => {
    const db = new PGlite();
    await expect(kör(db)).resolves.not.toThrow();
    await db.close();
  });

  it("skriver märket vid uppsättningen", async () => {
    const db = new PGlite();
    await kör(db);
    const { rows } = await db.query<{ app: string }>("select app from schema_app_identity");
    expect(rows.map((r) => r.app)).toEqual(["borjes-schema"]);
    await db.close();
  });

  it("släpper igenom vår egen databas en gång till", async () => {
    const db = new PGlite();
    await kör(db);
    await expect(kör(db)).resolves.not.toThrow();
    await db.close();
  });

  /* Det som faktiskt ska hindras: en databas som redan används av något
     annat. */
  it("vägrar köra i en databas som tillhör något annat", async () => {
    const db = new PGlite();
    await db.exec("create table fakturor (id serial primary key, belopp int)");

    await expect(kör(db)).rejects.toThrow(/Fel databas/);

    /* Avbrottet lämnar transaktionen öppen och avbruten — nästa fråga
       får "current transaction is aborted" tills någon avslutar den.
       Så gör en riktig klient också; rollbacken här är den avslutningen,
       inte en städning av något testet ställt till med. */
    await db.exec("ROLLBACK");

    // Och ingenting ska ha skapats — hela filen ligger i en transaktion.
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema='public'",
    );
    expect(rows[0].n).toBe(1); // bara fakturor
    await db.close();
  });

  it("nämner Supabase-projektets namn i felet, så det går att åtgärda", async () => {
    const db = new PGlite();
    await db.exec("create table nagot_annat (id int)");
    await expect(kör(db)).rejects.toThrow(/Schema/);
    await db.close();
  });

  /* Ett märke som säger något annat betyder att tabellnamnen råkar
     sammanfalla men databasen är någon annans. */
  it("vägrar när märket tillhör en annan app", async () => {
    const db = new PGlite();
    await db.exec(
      "create table schema_app_identity (app text primary key, installed_at timestamptz default now())",
    );
    await db.exec("insert into schema_app_identity (app) values ('nagon-annans-app')");

    await expect(kör(db)).rejects.toThrow(/annan app/);
    await db.close();
  });

  /* Listan över egna tabeller genereras ur schemat. Görs den för hand
     rostar den vid nästa nya tabell, och en rostig lista gör vakten till
     en slumpgenerator. */
  it("räknar alla appens tabeller som egna", async () => {
    const sql = await setupSql();
    for (const t of ["board", "employee", "transpa_outbox", "schema_app_identity"]) {
      expect(sql).toContain(`'${t}'`);
    }
  });

  /* Det här var det verkliga felet, inte ett tänkt: work_pattern finns
     inte i dagens schema men skapades av 0000 och droppades först av
     0005. En databas som stannat däremellan bär den. Räknas den som
     främmande vägrar vakten köra i vår egen databas. */
  it("räknar tabeller vi skapat och sedan droppat som egna", async () => {
    const sql = await setupSql();
    expect(sql).toContain("'work_pattern'");
    expect(sql).toContain("'work_pattern_day'");
  });

  it("läser egna tabeller ur både schemat och migrationerna", () => {
    const namn = ownTables(['CREATE TABLE "nagot_gammalt" ("id" uuid);']);
    expect(namn).toContain("nagot_gammalt"); // ur migrationen
    expect(namn).toContain("board"); // ur schemat
  });
});
