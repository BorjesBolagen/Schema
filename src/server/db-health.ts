import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema, isHostedDatabase, readWithTimeout } from "@/db";

export interface DbHealthCheck {
  label: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface DbHealthReport {
  hosted: boolean;
  /** Regionen funktionen faktiskt kördes i — Vercel sätter den här. */
  region: string | null;
  ranAt: string;
  checks: DbHealthCheck[];
  totalMs: number;
}

/**
 * Åtta sekunders egen gräns, inte bara sidans vanliga: en diagnostikssida
 * som själv kan hänga i fem minuter duger inte som diagnostik. Fastnar
 * en fråga rapporteras det som just det, i stället för att hela sidan
 * blir lika oanvändbar som det den skulle undersöka.
 */
async function timed(label: string, run: () => Promise<unknown>): Promise<DbHealthCheck> {
  const t0 = Date.now();
  try {
    await readWithTimeout(run, 8000);
    return { label, ok: true, ms: Date.now() - t0 };
  } catch (error) {
    return {
      label,
      ok: false,
      ms: Date.now() - t0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Testar databaskopplingen direkt, på begäran.
 *
 * Poängen: att veta om det är kopplingen som är trög eller sidan som
 * gör för mycket ska inte kräva att man skapar en tavla och väntar på
 * en krasch. Tre separata frågor i stället för en, så en enstaka
 * långsam fråga syns i stället för att drunkna i en total.
 */
export async function probeDb(): Promise<DbHealthReport> {
  const ranAt = new Date().toISOString();
  const t0 = Date.now();

  // getDb() anropas i varje test för sig, inte en gång i förväg: fastnar
  // ett test pensioneras den delade kopplingen (readWithTimeout), och
  // nästa test ska då pröva den nya kopplingen, inte den kastade.
  const checks = [
    await timed("Anslutning + enkel fråga (select 1)", () => getDb().execute(sql`select 1`)),
    await timed("Läs app_user", () => getDb().select().from(schema.appUser).limit(1)),
    await timed("Läs board", () => getDb().select().from(schema.board).limit(1)),
  ];

  return {
    hosted: isHostedDatabase(),
    region: process.env.VERCEL_REGION ?? null,
    ranAt,
    checks,
    totalMs: Date.now() - t0,
  };
}
