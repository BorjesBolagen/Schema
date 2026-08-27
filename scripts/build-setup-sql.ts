/**
 * Slår ihop migrationerna till en fil som går att klistra in i
 * Supabases SQL-editor.
 *
 * Finns för att första uppsättningen inte ska kräva att någon kör node
 * mot produktionsdatabasen. Migrationerna är fortfarande källan —
 * filen genereras från dem och ska inte redigeras för hand.
 *
 * Filen görs om till att tåla att köras om.
 *
 * Skälet är att den databas som finns nästan aldrig är tom. Efter
 * första uppsättningen är den migrerad till någon punkt, och den som
 * ska lägga på det senaste vet inte vilken punkt det är — det står
 * ingenstans i Supabases editor. Utan omkörningståligheten stannar
 * inklistringen på första bästa `CREATE TYPE` med "already exists", och
 * då är det inte uppenbart om det betyder "allt är redan gjort" eller
 * "hälften är gjort och resten fattas".
 *
 * Så varje sats görs ofarlig att upprepa: det som redan finns hoppas
 * över, det som fattas läggs på. Fel som inte handlar om att något
 * redan finns får fortfarande fälla körningen — hela filen ligger i en
 * transaktion, så en halvvägs pålagd migration finns inte som utfall.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";

/**
 * Gör en enskild sats ofarlig att köra om.
 *
 * Två sorters åtgärd. Det som Postgres själv kan uttrycka — `IF NOT
 * EXISTS`, `IF EXISTS` — skrivs så, för det säger vad som menas. Det
 * som saknar en sådan form, som `CREATE TYPE` och `ADD CONSTRAINT`,
 * läggs i ett DO-block som fångar just "finns redan" och inget annat.
 *
 * Ett bredare undantag vore lättare att skriva och sämre att lita på:
 * det skulle svälja ett stavfel i ett kolumnnamn lika tyst som en
 * upprepning.
 */
export function makeIdempotent(statement: string): string {
  const sql = statement.trim();
  if (!sql) return sql;

  /* Ett DO-block som redan står i migrationen är handskrivet och
     kontrollerar sina egna villkor. Rör det inte. */
  if (/^DO\s+\$\$/i.test(sql)) return sql;

  const guard = (body: string, ...errors: string[]) =>
    `DO $$ BEGIN\n${body.replace(/^/gm, "  ")}\nEXCEPTION WHEN ${errors.join(
      " OR ",
    )} THEN NULL;\nEND $$;`;

  /* CREATE TYPE saknar IF NOT EXISTS i Postgres. */
  if (/^CREATE TYPE\b/i.test(sql)) return guard(sql, "duplicate_object");

  /* ADD CONSTRAINT saknar det också. En främmande nyckel som redan
     finns ger duplicate_object — men en UNIQUE-nyckel bygger ett index
     under sig, och då kommer felet därifrån i stället: duplicate_table,
     "relation already exists". Båda måste med. */
  if (/^ALTER TABLE\b[\s\S]*\bADD CONSTRAINT\b/i.test(sql))
    return guard(sql, "duplicate_object", "duplicate_table");

  /* ENABLE ROW LEVEL SECURITY är i sig ofarlig att upprepa, men
     tabellen kan ha hunnit tas bort av en senare migration — då är
     satsen inte längre meningsfull och ska hoppas över, inte fälla. */
  if (/\bENABLE ROW LEVEL SECURITY\b/i.test(sql)) return guard(sql, "undefined_table");

  return sql
    .replace(/^CREATE TABLE\s+(?!IF NOT EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE(\s+UNIQUE)?\s+INDEX\s+(?!IF NOT EXISTS)/i, "CREATE$1 INDEX IF NOT EXISTS ")
    .replace(/\bADD COLUMN\s+(?!IF NOT EXISTS)/i, "ADD COLUMN IF NOT EXISTS ")
    .replace(/\bDROP COLUMN\s+(?!IF EXISTS)/i, "DROP COLUMN IF EXISTS ")
    .replace(/\bDROP CONSTRAINT\s+(?!IF EXISTS)/i, "DROP CONSTRAINT IF EXISTS ");
}

/** Delar en migration i satser. Brytpunkterna är Drizzles egna markörer. */
export function statementsOf(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = "drizzle";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const parts: string[] = [
    "-- Genererad av scripts/build-setup-sql.ts — redigera inte för hand.",
    "-- Klistra in i Supabase → SQL Editor och kör.",
    "--",
    "-- Går att köra om. Det som redan finns hoppas över, det som fattas",
    "-- läggs på. Kör den alltså i sin helhet även mot en databas som",
    "-- redan är uppsatt — du behöver inte veta hur långt den kommit.",
    `-- Migrationer: ${files.join(", ")}`,
    "",
    "BEGIN;",
    "",
  ];

  for (const file of files) {
    parts.push(`-- ${file}`);
    for (const statement of statementsOf(await readFile(`${dir}/${file}`, "utf8"))) {
      parts.push(makeIdempotent(statement));
    }
    parts.push("");
  }

  /* Drizzle spårar vilka migrationer som körts. Utan de raderna vill
     npm run db:migrate köra allt en gång till och kraschar på tabeller
     som redan finns. */
  parts.push(
    "-- Markera migrationerna som körda, så npm run db:migrate inte",
    "-- försöker köra dem igen mot samma databas.",
    "CREATE SCHEMA IF NOT EXISTS drizzle;",
    'CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (',
    "  id SERIAL PRIMARY KEY,",
    "  hash text NOT NULL,",
    "  created_at bigint",
    ");",
  );

  const journal = JSON.parse(await readFile(`${dir}/meta/_journal.json`, "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const { createHash } = await import("node:crypto");
  for (const entry of journal.entries) {
    const sql = await readFile(`${dir}/${entry.tag}.sql`, "utf8");
    const hash = createHash("sha256")
      .update(sql.split("--> statement-breakpoint").join(""))
      .digest("hex");
    parts.push(
      `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '${hash}', ${entry.when}`,
      `WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '${hash}');`,
    );
  }

  parts.push("", "COMMIT;", "");

  const out = "docs/supabase-setup.sql";
  await writeFile(out, parts.join("\n"));
  console.log(`Skrev ${out} från ${files.length} migration(er).`);
}
