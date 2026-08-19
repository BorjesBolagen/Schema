import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import * as schema from "./schema";

export type Db =
  | ReturnType<typeof drizzlePg<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

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
    return drizzlePg(postgres(url, { max: 10 }), { schema });
  }
  const dataDir = url?.replace(/^pglite:\/\//, "") ?? process.env.PGLITE_DIR ?? "memory://";
  return drizzlePglite(new PGlite(dataDir), { schema });
}

let cached: Db | undefined;

/** Delad koppling för Next-processen. */
export function getDb(): Db {
  cached ??= createDb();
  return cached;
}

export { schema };
