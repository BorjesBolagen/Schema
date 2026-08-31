import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { Db } from "./index";
import { assertRightProject } from "./project-guard";

const MIGRATIONS_FOLDER = "./drizzle";

/**
 * Kör migrationerna mot vilken av de två drivrutinerna som än används.
 *
 * Vakten först: samma kontroll som uppsättningsfilen gör, av samma skäl.
 * En DATABASE_URL som pekar fel ser likadan ut som en som pekar rätt.
 */
export async function runMigrations(db: Db, folder = MIGRATIONS_FOLDER): Promise<void> {
  await assertRightProject(db);
  const client = (db as { $client?: { constructor?: { name?: string } } }).$client;
  const isPglite = client?.constructor?.name === "PGlite";
  if (isPglite) {
    await migratePglite(db as never, { migrationsFolder: folder });
  } else {
    await migratePg(db as never, { migrationsFolder: folder });
  }
}
