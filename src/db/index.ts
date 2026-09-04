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
 * förberedda satser går inte att använda, och antalet egna anslutningar
 * ska hållas lågt i stället för en egen stor pool — Vercels "Fluid"-läge
 * kan låta flera samtidiga förfrågningar dela en och samma körande
 * instans, så "en anslutning per instans" räcker inte som tumregel
 * längre; se max i createDb().
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
      // 3, inte 1: en enda tavelsida gör över tio frågor i två
      // parallella klumpar, och Fluid kan dessutom lägga flera
      // samtidiga användares förfrågningar på samma instans. Med bara
      // en anslutning köar allt det bakom varandra i onödan. 3 räcker
      // för att ge verklig parallellitet utan att hota Supabases
      // anslutningsbudget för ett så här litet verktyg.
      max: pooled ? 3 : 10,
      prepare: !pooled,
      // Kort viloliv, medvetet. Ju längre en anslutning ligger oanvänd,
      // desto större chans att motparten eller något däremellan hunnit
      // glömma bort den utan att säga till — och en sådan sockel märks
      // inte förrän en fråga skickas och svaret aldrig kommer. Att
      // öppna en ny mot poolern i samma region kostar millisekunder;
      // en död sockel kostar en hängd sida.
      idle_timeout: pooled ? 5 : undefined,
      max_lifetime: pooled ? 60 * 5 : undefined,
      keep_alive: pooled ? 15 : undefined,
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
 * postgres-js har `end()`, PGlite har `close()` — bara den ena finns
 * beroende på drivrutin. postgres-js `end()` väntar annars på att
 * pågående frågor blir klara innan den stänger, utan tidsgräns — i
 * praktiken för evigt på en fråga som fastnat, vilket är precis det
 * den här funktionen kan behöva städa upp efter. Fem
 * sekunders nåd åt en legitimt pågående fråga, sedan tvingas den
 * igenom.
 */
export async function closeDb(db: Db): Promise<void> {
  const client = (
    db as {
      $client?: { end?: (opts?: { timeout: number }) => Promise<void>; close?: () => Promise<void> };
    }
  ).$client;
  await client?.end?.({ timeout: 5 });
  await client?.close?.();
}

/**
 * Pensionerar den delade kopplingen: nästa getDb() bygger en ny.
 *
 * Stänger medvetet INTE den gamla. Vercels "Fluid"-läge kan låta flera
 * samtidiga förfrågningar dela samma körande instans och därmed samma
 * koppling — stänger man den drar man undan mattan för alla andra som
 * håller på med den just då. Precis det hände: en helt oskyldig
 * session-koll kraschade med CONNECTION_DESTROYED för att en tavelsida
 * i en annan förfrågan gav upp på samma koppling samtidigt.
 *
 * Den gamla lämnas därför att dö av sig själv — pågående frågor på den
 * får leva klart, och sockeln städas av idle_timeout eller när
 * instansen avvecklas. Den kostar lite minne tills dess; det är billigt
 * jämfört med att krascha andras förfrågningar.
 */
function retireDb(stale: Db): void {
  const g = globalThis as GlobalWithDb;
  if (g[DB_KEY] === stale) g[DB_KEY] = createDb();
}

const TIMEOUT_MARK = Symbol("db-timeout");
type TimeoutError = Error & { [TIMEOUT_MARK]?: true };

function raceTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error: TimeoutError = new Error(
        `Databasanropet svarade inte inom ${Math.round(ms / 1000)} sekunder.`,
      );
      error[TIMEOUT_MARK] = true;
      reject(error);
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer!));
}

/**
 * Kör en **läsning** med tidsgräns och ett omtag på en färsk koppling.
 *
 * Bakgrunden: postgres-drivrutinen har ingen lässtidsgräns. Dör sockeln
 * tyst — utan FIN, utan RST, precis som när Vercel fryser en instans
 * mellan två anrop, eller när en brandvägg glömmer bort anslutningen —
 * skickas frågan i väg och svaret kommer aldrig. Drivrutinen väntar för
 * evigt, och sidan hänger tills plattformens egen gräns på 300 sekunder.
 * Verifierat genom att låta en TCP-proxy tyst svälja trafiken mitt i.
 *
 * Därför två steg: ge upp efter `ms`, pensionera den (troligen döda)
 * kopplingen, och gör om anropet på en färsk. Ett omtag räcker — går
 * även det andra försöket i taget är det inte en död sockel utan något
 * verkligt fel, och då ska det synas.
 *
 * **Bara för läsningar.** Omtaget kör anropet en gång till, vilket bara
 * är ofarligt när det inte skriver något. Skrivningar får ta
 * raceTimeout() direkt om de behöver en gräns.
 *
 * `db` är kopplingen anropet faktiskt använder. Utelämnad betyder den
 * globala, som i drift. Den som skickar en egen — scoping-funktionerna
 * gör det, för att gå att prova mot en egen databas — måste skicka den
 * hit också: annars pensioneras fel koppling vid en tidsgräns, och i
 * ett test *skapades* dessutom en global bara för att hålla den här
 * raden. Nio sådana i samma fil räckte för att PGlite skulle avbryta i
 * nedstängningen, och hela provkörningen slutade med felkod trots att
 * varje enskilt prov var grönt.
 */
export async function readWithTimeout<T>(
  fn: () => Promise<T>,
  ms = 6_000,
  db?: Db,
): Promise<T> {
  const used = db ?? getDb();
  try {
    return await raceTimeout(fn(), ms);
  } catch (error) {
    if (!(error as TimeoutError)?.[TIMEOUT_MARK]) throw error;
    retireDb(used);
    return raceTimeout(fn(), ms);
  }
}

/**
 * Raderna ur en rå db.execute(), oavsett drivrutin.
 *
 * postgres-js returnerar en array; PGlite returnerar { rows }. Skillnaden
 * syns inte i typerna, så en destrukturering av resultatet fungerade i
 * produktion och kraschade lokalt med "(intermediate value) is not
 * iterable" — och en cast till [T] gjorde tystnaden fullständig genom
 * att påstå en form som inte fanns. Därför den här: en enda plats som
 * vet vad drivrutinerna gör.
 */
export function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** True när appen kör mot en riktig Postgres och inte den inbäddade. */
export function isHostedDatabase(): boolean {
  return isPostgresUrl(connectionUrl());
}

export { schema };
