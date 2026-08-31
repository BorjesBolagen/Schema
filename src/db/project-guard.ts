import { sql } from "drizzle-orm";
import type { Db } from "./index";

/** Märket migration 0010 skriver. Samma sträng som i schema.ts. */
export const APP_MARK = "borjes-schema";

/**
 * Tabeller som bara vi skapar, ur den allra första migrationen.
 *
 * Finns för databaser som migrerades innan 0010 fanns och därför saknar
 * märket. De är våra, och att vägra köra i dem vore att låsa ute oss
 * själva.
 */
const OUR_OLDEST = ["board", "board_row", "assignment"];

export class WrongProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongProjectError";
  }
}

export interface DbFingerprint {
  /** schema_app_identity finns. */
  hasMark: boolean;
  /** …och innehåller vårt märke. */
  markIsOurs: boolean;
  /** Antal tabeller i public, oavsett vem som äger dem. */
  tables: number;
  /** Hur många av OUR_OLDEST som finns. */
  ourOldest: number;
}

/**
 * Avgör om en databas är vår, utan att fråga databasen något mer.
 *
 * Skild från hämtningen för att gå att pröva. Reglerna är få, och de är
 * hellre tillåtande än stränga i tveksamma fall — en vakt som stoppar
 * en riktig migrering är dyrare än den skyddar, eftersom nästa steg då
 * blir att stänga av den.
 */
export function verdict(f: DbFingerprint): { ok: true } | { ok: false; reason: string } {
  if (f.hasMark) {
    return f.markIsOurs
      ? { ok: true }
      : {
          ok: false,
          reason:
            "schema_app_identity finns men saknar märket " +
            `"${APP_MARK}" — databasen tillhör en annan app.`,
        };
  }
  /* Tom databas: förstagångsuppsättning. */
  if (f.tables === 0) return { ok: true };
  /* Migrerad av oss innan märket fanns. */
  if (f.ourOldest === OUR_OLDEST.length) return { ok: true };
  return {
    ok: false,
    reason:
      `Databasen har ${f.tables} tabeller men varken Schemas märke eller Schemas ` +
      "egna grundtabeller. Kontrollera att du pekar på Supabase-projektet \"Schema\".",
  };
}

async function fingerprint(db: Db): Promise<DbFingerprint> {
  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  /* postgres-js ger en array, PGlite ett objekt med rows. */
  const names = new Set(
    (Array.isArray(tables) ? tables : ((tables as { rows: Array<{ table_name: string }> }).rows ?? []))
      .map((r) => r.table_name),
  );

  let markIsOurs = false;
  if (names.has("schema_app_identity")) {
    const marks = await db.execute<{ app: string }>(sql`select app from schema_app_identity`);
    const rows = Array.isArray(marks)
      ? marks
      : ((marks as { rows: Array<{ app: string }> }).rows ?? []);
    markIsOurs = rows.some((r) => r.app === APP_MARK);
  }

  return {
    hasMark: names.has("schema_app_identity"),
    markIsOurs,
    tables: names.size,
    ourOldest: OUR_OLDEST.filter((t) => names.has(t)).length,
  };
}

/**
 * Vägrar ändra en databas som inte är vår.
 *
 * Körs före migrationerna. Skälet är att ingenting i uppkopplingen
 * säger vilket Supabase-projekt en URL pekar på — en bortglömd
 * DATABASE_URL i skalet räcker för att lägga tjugo tabeller i fel
 * projekt, och det syns inte förrän någon undrar varför.
 */
export async function assertRightProject(db: Db): Promise<void> {
  const v = verdict(await fingerprint(db));
  if (!v.ok) throw new WrongProjectError(`Fel databas. ${v.reason}`);
}
