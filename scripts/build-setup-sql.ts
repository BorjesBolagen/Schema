/**
 * Slår ihop migrationerna till en fil som går att klistra in i
 * Supabases SQL-editor.
 *
 * Finns för att första uppsättningen inte ska kräva att någon kör node
 * mot produktionsdatabasen. Migrationerna är fortfarande källan —
 * filen genereras från dem och ska inte redigeras för hand.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";

const dir = "drizzle";
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const parts: string[] = [
  "-- Genererad av scripts/build-setup-sql.ts — redigera inte för hand.",
  "-- Klistra in i Supabase → SQL Editor och kör.",
  `-- Migrationer: ${files.join(", ")}`,
  "",
  "BEGIN;",
  "",
];

for (const file of files) {
  const sql = await readFile(`${dir}/${file}`, "utf8");
  parts.push(`-- ${file}`);
  // Drizzles brytpunkter är bara markörer och ska inte med i utdata.
  parts.push(sql.split("--> statement-breakpoint").join("").trim());
  parts.push("");
}

parts.push("COMMIT;", "");

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

const out = "docs/supabase-setup.sql";
await writeFile(out, parts.join("\n"));
console.log(`Skrev ${out} från ${files.length} migration(er).`);
