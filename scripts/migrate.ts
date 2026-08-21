/**
 * Kör migrationerna mot den databas DATABASE_URL pekar på.
 *
 * Körs manuellt vid driftsättning; Vercels byggsteg rör inte databasen
 * eftersom bygget kan köras parallellt och en migration inte ska starta
 * flera gånger samtidigt.
 *
 *   DATABASE_URL=... npm run db:migrate
 */
import { createDb, isHostedDatabase } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";

const target = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).host
  : "lokal PGlite (.pgdata)";

console.log(`Migrerar ${target}…`);
await runMigrations(createDb());
console.log(isHostedDatabase() ? "Klart." : "Klart (lokal databas).");
process.exit(0);
