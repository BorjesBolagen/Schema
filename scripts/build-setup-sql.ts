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
import { getTableName, isTable, type Table } from "drizzle-orm";
import * as schema from "../src/db/schema";

/**
 * Tabellerna appen äger — allt vi någonsin skapat, inte bara det som
 * finns kvar.
 *
 * Två källor, och båda behövs. Schemat säger vad som gäller i dag;
 * migrationerna säger vad som funnits. Skillnaden är inte teoretisk:
 * employee_alias och unresolved_alias skapades av 0000 och droppades av
 * 0005, så en databas som stannat vid 0003 bär dem. Räknades bara
 * dagens schema skulle vakten läsa dem som främmande och vägra köra i
 * *vår egen* databas — vilket är precis vad testet visade.
 *
 * Uppräknat för hand skulle listan dessutom rosta vid nästa nya tabell,
 * och en rostig lista gör vakten till en slumpgenerator.
 */
export function ownTables(migrations: string[]): string[] {
  const names = new Set(
    /* Schemat exporterar också enum:er och konstanter — isTable sållar,
       men typen måste vidgas först eftersom Object.values ser dem alla. */
    (Object.values(schema) as unknown[])
      .filter((x): x is Table => isTable(x))
      .map((t) => getTableName(t)),
  );
  for (const sql of migrations) {
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi,
    )) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

/**
 * Vägrar köra i fel Supabase-projekt.
 *
 * Filen klistras in för hand, och SQL-editorn säger ingenting om vilket
 * projekt man har framme. Hamnar den fel skapas tjugo tabeller där de
 * inte hör hemma.
 *
 * Regeln: har databasen tabeller i public men saknar vårt märke är det
 * någon annans databas. En tom databas släpps igenom — det är en
 * förstagångsuppsättning, och märket skrivs av migration 0010.
 *
 * Vakten körs innan allt annat och inuti samma transaktion, så ett
 * avbrott lämnar databasen orörd.
 */
function guard(tables: string[]): string[] {
  const lista = tables.map((t) => `'${t}'`).join(", ");
  return [
    "-- Vägrar köra i fel projekt. Se kommentaren i scripts/build-setup-sql.ts.",
    "DO $$",
    "DECLARE",
    "  marke int;",
    "  frammande int;",
    "BEGIN",
    "  SELECT count(*) INTO marke FROM information_schema.tables",
    "   WHERE table_schema = 'public' AND table_name = 'schema_app_identity';",
    "",
    "  SELECT count(*) INTO frammande FROM information_schema.tables",
    "   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    `     AND table_name NOT IN (${lista});`,
    "",
    "  IF marke = 0 AND frammande > 0 THEN",
    "    RAISE EXCEPTION",
    "      'Fel databas. Det här projektet har % tabeller som inte hör till Schema, och saknar Schemas märke. Kontrollera att du är i Supabase-projektet \"Schema\" innan du kör om.',",
    "      frammande;",
    "  END IF;",
    "",
    "  IF marke > 0 THEN",
    "    PERFORM 1 FROM schema_app_identity WHERE app = 'borjes-schema';",
    "    IF NOT FOUND THEN",
    "      RAISE EXCEPTION",
    "        'Fel databas. schema_app_identity finns men innehåller inte borjes-schema — databasen tillhör en annan app.';",
    "    END IF;",
    "  END IF;",
    "END $$;",
    "",
  ];
}

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
  const migrations = await Promise.all(files.map((f) => readFile(`${dir}/${f}`, "utf8")));

  const parts: string[] = [
    "-- Genererad av scripts/build-setup-sql.ts — redigera inte för hand.",
    "-- Klistra in i Supabase → SQL Editor och kör.",
    "--",
    "-- Går att köra om. Det som redan finns hoppas över, det som fattas",
    "-- läggs på. Kör den alltså i sin helhet även mot en databas som",
    "-- redan är uppsatt — du behöver inte veta hur långt den kommit.",
    "--",
    "-- Vägrar köra i ett Supabase-projekt som tillhör något annat. Se",
    "-- vakten längst upp: har databasen tabeller men saknar Schemas",
    "-- märke avbryts allt, och ingenting skrivs.",
    `-- Migrationer: ${files.join(", ")}`,
    "",
    "BEGIN;",
    "",
    ...guard(ownTables(migrations)),
  ];

  for (const [i, file] of files.entries()) {
    parts.push(`-- ${file}`);
    for (const statement of statementsOf(migrations[i])) {
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
  const hashes: Array<{ tag: string; hash: string; when: number }> = [];
  for (const entry of journal.entries) {
    const sql = await readFile(`${dir}/${entry.tag}.sql`, "utf8");
    /* Hela filen, brytpunktsmarkörerna inräknade.
       Drizzles egen migrator hashar filen precis som den ligger, och
       den här raden ska säga åt den att migrationen redan är körd.
       Strippades markörerna först — vilket den här koden gjorde — blev
       hashen en annan än den drizzle letar efter, och markeringen
       missade sitt syfte utan att någon märkte det. */
    const hash = createHash("sha256").update(sql).digest("hex");
    hashes.push({ tag: entry.tag, hash, when: entry.when });
    parts.push(
      `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '${hash}', ${entry.when}`,
      `WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '${hash}');`,
    );
  }

  parts.push("", "COMMIT;", "");

  const out = "docs/supabase-setup.sql";
  await writeFile(out, parts.join("\n"));

  /* Samma uppgifter som en modul appen kan läsa vid körning.
     Vakten som varnar för en oskriven migration behöver veta vilka som
     finns, och drizzle-katalogen följer inte med i en Vercel-byggnad.
     Genererad här, av samma källa, så de inte kan säga emot varandra. */
  const manifest = [
    "/**",
    " * Migrationerna, som en modul.",
    " *",
    " * GENERERAD av scripts/build-setup-sql.ts — redigera inte för hand.",
    " *",
    " * Finns för att appen ska kunna säga *vilken* migration som fattas",
    " * när databasen ligger efter koden. Drizzle-katalogen finns inte i",
    " * en byggd app, så uppgifterna måste bakas in.",
    " */",
    "",
    "export interface MigrationRef {",
    "  tag: string;",
    "  hash: string;",
    "}",
    "",
    "export const MIGRATIONS: MigrationRef[] = [",
    ...hashes.map((h) => `  { tag: "${h.tag}", hash: "${h.hash}" },`),
    "];",
    "",
  ].join("\n");
  await writeFile("src/db/migrations-manifest.ts", manifest);

  console.log(`Skrev ${out} och manifestet från ${files.length} migration(er).`);
}
