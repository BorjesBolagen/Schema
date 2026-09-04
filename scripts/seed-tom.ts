/**
 * En tom databas med bara ett konto att logga in med.
 *
 * Finns för e2e-tomstart, som provar vägen en *ny* installation tar:
 * skapa tavla, lägga in stationsort, personal och fordon. Det kräver att
 * ingenting av det redan finns. Demounderlaget ger motsatsen, och kördes
 * skriptet mot det blev felet en trettio sekunders timeout på en
 * fältväljare — vilket säger att fältet saknas, inte att man seedat fel.
 *
 *   rm -rf .pgdata && npx tsx scripts/seed-tom.ts
 */
import { parseArgs } from "node:util";
import { count } from "drizzle-orm";
import { closeDb, createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";
import { hashPassword } from "../src/lib/password";

const { values } = parseArgs({ options: { db: { type: "string" } }, allowPositionals: true });
const db = createDb(values.db ?? process.env.DATABASE_URL ?? process.env.PGLITE_DIR ?? "./.pgdata");
await runMigrations(db);

/* Samma spärr som demounderlaget: den här filen ska inte kunna köras
   mot en databas som används. */
const finns = await db.select({ n: count() }).from(schema.employee);
if ((finns[0]?.n ?? 0) > 0) {
  console.error(
    "Databasen innehåller redan personal — den här filen sätter upp en tom databas.\n" +
      "Ta bort .pgdata först, eller peka DATABASE_URL på en tom databas.",
  );
  await closeDb(db);
  process.exit(1);
}

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.se";
const password = process.env.SEED_ADMIN_PASSWORD ?? "schema-demo-2026";
await db
  .insert(schema.appUser)
  .values({
    email,
    name: "Administratör",
    role: "admin",
    passwordHash: await hashPassword(password),
  })
  .onConflictDoNothing({ target: schema.appUser.email });

console.log(`Tom databas. Inloggning: ${email} / ${password}`);
await closeDb(db);
