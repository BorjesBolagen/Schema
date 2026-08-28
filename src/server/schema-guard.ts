import "server-only";
import { sql } from "drizzle-orm";
import { getDb, rowsFromExecute, type Db } from "@/db";
import { MIGRATIONS } from "@/db/migrations-manifest";

/**
 * Vakt mot att koden är utrullad före migrationen.
 *
 * Det har hänt två gånger, och båda gångerna såg det likadant ut: en rå
 * SQL-krasch med en stackspårning, på en sida som fungerade minuten
 * innan. Felet säger `column "cycle_length" does not exist`, vilket är
 * sant men obrukbart — det står ingenstans att svaret är att köra
 * docs/supabase-setup.sql.
 *
 * Att glömma trycka är inte felet. Felet är att appen inte säger vad som
 * fattas när den vet det.
 */

/** Postgres feltyper för kolumn respektive tabell som inte finns. */
const UNDEFINED_COLUMN = "42703";
const UNDEFINED_TABLE = "42P01";

/**
 * Är det här ett fel som betyder att databasen ligger efter koden?
 *
 * Drivrutinen lägger felet under `cause`, så koden ligger ett steg ned.
 * Bara de två koderna räknas: allt annat är ett riktigt fel som ska
 * fortsätta uppåt i stället för att döljas bakom ett hjälpsamt budskap.
 */
export function isSchemaOutOfDate(error: unknown): boolean {
  const kod = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : undefined;

  for (let e: unknown = error, djup = 0; e && djup < 5; djup++) {
    const c = kod(e);
    if (c === UNDEFINED_COLUMN || c === UNDEFINED_TABLE) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Migrationer som finns i koden men inte i databasen.
 *
 * Tom lista betyder antingen att allt är kört, eller att frågan inte
 * gick att ställa — och de två skiljs åt av `ok`. En vakt som säger
 * "inget fattas" när den inte kunde titta vore värre än ingen vakt.
 */
export async function pendingMigrations(
  dbOverride?: Db,
): Promise<{ ok: boolean; pending: string[] }> {
  try {
    const rows = rowsFromExecute<{ hash: string }>(
      await (dbOverride ?? getDb()).execute(
        sql`select hash from drizzle."__drizzle_migrations"`,
      ),
    );
    const körda = new Set(rows.map((r) => r.hash));
    return { ok: true, pending: MIGRATIONS.filter((m) => !körda.has(m.hash)).map((m) => m.tag) };
  } catch {
    /* Saknas tabellen har ingen migration körts alls, men det kan lika
       gärna vara ett behörighetsfel. Skilj inte på dem här — säg bara
       att svaret inte går att lita på. */
    return { ok: false, pending: [] };
  }
}

export interface SchemaStatus {
  outOfDate: boolean;
  pending: string[];
}

/**
 * Vad ett misslyckat anrop berodde på, om det berodde på schemat.
 *
 * Anropas först när något gått fel, så den kostar ingenting när allt
 * fungerar — och den extra frågan mot databasen ställs bara i det läge
 * där svaret faktiskt behövs.
 */
export async function schemaStatusFor(error: unknown): Promise<SchemaStatus | null> {
  if (!isSchemaOutOfDate(error)) return null;
  const { pending } = await pendingMigrations();
  return { outOfDate: true, pending };
}
