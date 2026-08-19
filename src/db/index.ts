import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Gemensam typ för båda drivrutinerna. Utan den blir varje
 * insert-anrop en union av två överlagringar och typningen faller isär.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Databaskoppling.
 *
 * DATABASE_URL som pekar på en postgres-server används i drift. Saknas
 * den körs PGlite — en inbäddad Postgres — vilket gör att importskript
 * och tester kan köras utan att någon startar en server. Samma SQL,
 * samma migrationer.
 */
export function createDb(url = process.env.DATABASE_URL): Db {
  if (url?.startsWith("postgres://") || url?.startsWith("postgresql://")) {
    return drizzlePg(postgres(url, { max: 10 }), { schema }) as unknown as Db;
  }
  const dataDir = url?.replace(/^pglite:\/\//, "") ?? process.env.PGLITE_DIR ?? "memory://";
  return drizzlePglite(new PGlite(dataDir), { schema }) as unknown as Db;
}

/**
 * Delad koppling för hela processen.
 *
 * Ligger på globalThis, inte i en modulvariabel. Next bygger sidor och
 * server-actions i skilda modulgrafer, så en modullokal cache ger dem
 * varsin PGlite mot samma katalog — skrivningar i den ena syns då aldrig
 * i den andra. Samma knep överlever dessutom omladdningen i utveckling.
 */
const DB_KEY = Symbol.for("schema.db");
type GlobalWithDb = typeof globalThis & { [DB_KEY]?: Db };

export function getDb(): Db {
  const g = globalThis as GlobalWithDb;
  g[DB_KEY] ??= createDb();
  return g[DB_KEY];
}

export { schema };
