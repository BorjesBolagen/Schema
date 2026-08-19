import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { Db } from "./index";

const MIGRATIONS_FOLDER = "./drizzle";

/** Kör migrationerna mot vilken av de två drivrutinerna som än används. */
export async function runMigrations(db: Db, folder = MIGRATIONS_FOLDER): Promise<void> {
  const client = (db as { $client?: { constructor?: { name?: string } } }).$client;
  const isPglite = client?.constructor?.name === "PGlite";
  if (isPglite) {
    await migratePglite(db as never, { migrationsFolder: folder });
  } else {
    await migratePg(db as never, { migrationsFolder: folder });
  }
}
