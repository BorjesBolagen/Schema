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

const isPostgresUrl = (url?: string) =>
  !!url && (url.startsWith("postgres://") || url.startsWith("postgresql://"));

/**
 * Supabase och andra hostade Postgres kör anslutningarna genom pgbouncer
 * i transaction mode. Där lever ingen session mellan frågorna, så
 * förberedda satser går inte att använda, och varje serverless-instans
 * ska hålla exakt en anslutning i stället för en egen pool.
 */
function isPooled(url: string): boolean {
  return url.includes("pgbouncer=true") || url.includes("pooler.") || url.includes(":6543");
}

/**
 * Databaskoppling.
 *
 * DATABASE_URL som pekar på en postgres-server används i drift. Saknas
 * den körs PGlite — en inbäddad Postgres i katalogen .pgdata — så appen
 * och testerna fungerar utan vare sig databasserver eller
 * miljövariabler. Samma SQL, samma migrationer.
 */
export function createDb(url = process.env.DATABASE_URL): Db {
  if (isPostgresUrl(url)) {
    const pooled = isPooled(url!);
    const client = postgres(url!, {
      max: pooled ? 1 : 10,
      prepare: !pooled,
      idle_timeout: pooled ? 20 : undefined,
      // Hostad Postgres kräver TLS men använder ofta ett internt cert.
      ssl: url!.includes("sslmode=disable") ? false : "require",
    });
    return drizzlePg(client, { schema }) as unknown as Db;
  }

  const dataDir = url?.replace(/^pglite:\/\//, "") ?? process.env.PGLITE_DIR ?? "./.pgdata";
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

/** True när appen kör mot en riktig Postgres och inte den inbäddade. */
export function isHostedDatabase(): boolean {
  return isPostgresUrl(process.env.DATABASE_URL);
}

export { schema };
