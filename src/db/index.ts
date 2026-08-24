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
 * TLS-läge.
 *
 * `sslmode` i URL:en vinner om den är satt. Utan den krävs TLS mot allt
 * som inte är localhost: hostad Postgres har det alltid, en databas man
 * kör själv under utveckling har det sällan.
 *
 * Standardläget måste bli strängen `"require"`, inte det booleska
 * `true` som såg mest korrekt ut. `postgres`-drivrutinen känner bara
 * igen `"require"`/`"allow"`/`"prefer"` som bett om att stänga av
 * certifikatverifieringen (`node_modules/postgres/src/connection.js`);
 * `true` matchar ingen av de grenarna och faller igenom till Nodes
 * strikta standardverifiering. Supabase pooler-certifikat klarar den
 * inte, vilket gav `SELF_SIGNED_CERT_IN_CHAIN` i drift trots korrekt
 * lösenord och korrekt sträng i övrigt.
 */
/** Exporterad enbart så testet kör mot den riktiga regeln, inte en kopia. */
export function sslSetting(url: string): "require" | "verify-full" | boolean {
  const mode = new URL(url).searchParams.get("sslmode");
  if (mode === "disable" || mode === "allow") return false;
  if (mode === "verify-full" || mode === "verify-ca") return "verify-full";
  if (mode === "require" || mode === "prefer") return "require";

  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  return "require";
}

/**
 * Miljövariabeln som bär anslutningssträngen.
 *
 * DATABASE_URL är den vi dokumenterar och som ska sättas för hand med
 * den poolade Supabase-strängen. De andra är reserver för när Supabase
 * kopplats till Vercel via deras integration i stället — den sätter
 * sina egna namn, och utan de här skulle appen tyst falla tillbaka på
 * den inbäddade PGlite-databasen i drift, vilket kraschar på Vercels
 * skrivskyddade filsystem.
 */
function connectionUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_PRISMA_URL
  );
}

/**
 * Databaskoppling.
 *
 * En postgres-URL används i drift. Saknas den körs PGlite — en
 * inbäddad Postgres i katalogen .pgdata — så appen och testerna
 * fungerar utan vare sig databasserver eller miljövariabler. Samma SQL,
 * samma migrationer.
 *
 * Vercels filsystem är skrivskyddat utanför /tmp, så PGlite-vägen
 * kraschar där — djupt inne i sitt eget filskrivningsförsök, med ett
 * felmeddelande som inte säger vad som faktiskt saknas. `VERCEL` sätts
 * automatiskt av plattformen (till skillnad från NODE_ENV, som också är
 * "production" för en lokal `next start` utan databas, vilket ska
 * fungera precis som `next dev` gör).
 */
export function createDb(url = connectionUrl()): Db {
  if (!isPostgresUrl(url) && process.env.VERCEL) {
    throw new Error(
      "Ingen databasanslutning hittades. Sätt DATABASE_URL till den poolade Supabase-strängen " +
        "(Project Settings → Database → Connection Pooling, port 6543) i Vercels miljövariabler " +
        "— se docs/drift.md.",
    );
  }

  if (isPostgresUrl(url)) {
    const pooled = isPooled(url!);
    const client = postgres(url!, {
      max: pooled ? 1 : 10,
      prepare: !pooled,
      idle_timeout: pooled ? 20 : undefined,
      ssl: sslSetting(url!),
      // Migreringen mot en databas som redan fått schemat utlagt via
      // SQL-filen ger "already exists, skipping" — väntat, och inget
      // som ska dumpa ett objekt i terminalen.
      onnotice: () => {},
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

/**
 * Stänger kopplingen.
 *
 * postgres-js håller anslutningen öppen tills den stängs, så ett skript
 * som glömmer det ser ut att hänga för evigt trots att arbetet är klart.
 * Webbappen ska inte anropa den — där ska kopplingen leva vidare.
 */
export async function closeDb(db: Db): Promise<void> {
  const client = (db as { $client?: { end?: () => Promise<void>; close?: () => Promise<void> } })
    .$client;
  await client?.end?.();
  await client?.close?.();
}

/** True när appen kör mot en riktig Postgres och inte den inbäddade. */
export function isHostedDatabase(): boolean {
  return isPostgresUrl(connectionUrl());
}

export { schema };
