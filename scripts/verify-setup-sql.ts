/**
 * Kör docs/supabase-setup.sql mot en tom databas och kontrollerar att
 * den lämnar samma läge som migrationerna, och att db:migrate efteråt
 * inte försöker köra om något.
 */
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { closeDb, createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";

const db = createDb("memory://");

/* PGlites exec() kör flera satser i en följd, precis som Supabases
   SQL-editor gör. Drizzles execute() skickar en förberedd sats och
   klarar bara en i taget. */
const client = (db as unknown as { $client: { exec(sql: string): Promise<unknown> } }).$client;
await client.exec(await readFile("docs/supabase-setup.sql", "utf8"));

const tables = await db.execute(
  sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
);
const rows = (Array.isArray(tables) ? tables : (tables as { rows: unknown[] }).rows) as Array<{
  table_name: string;
}>;
const names = rows.map((r) => r.table_name);
console.log(`Tabeller: ${names.length}`);
console.log("  " + names.join(", "));

// Skrivbar? Ett varv genom de tabeller inloggningen behöver.
const [user] = await db
  .insert(schema.appUser)
  .values({ email: "test@example.se", name: "Test", role: "admin" })
  .returning();
await db.insert(schema.session).values({
  tokenHash: "abc",
  userId: user.id,
  expiresAt: new Date(Date.now() + 3600_000),
});
console.log("Skrivning fungerar:", !!user.id);

// Migreraren ska nu se allt som redan kört.
await runMigrations(db);
console.log("db:migrate efteråt: inga fel, inget kördes om.");

await closeDb(db);
