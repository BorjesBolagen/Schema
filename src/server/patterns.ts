import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shift } from "@/lib/work-days";

/**
 * Arbetsmönster — skrivvägen, på ett ställe.
 *
 * Mönstren är källan till arbetsdagar: TransPA levererar inga planerade
 * pass, ingen frånvaro och ingen semester, och turerna är för glesa för
 * att bära ett veckomönster. Det som står här är alltså det enda som
 * säger när någon jobbar, och tre olika ställen ville skriva det —
 * mönsterredigeraren, massättningen i Grunddata och förslaget ur
 * turhistoriken. De delar den här.
 */

export interface PatternDayInput {
  cycleWeek: number;
  weekday: number;
  shift: Shift;
}

export interface PatternInput {
  cycleWeeks: number;
  anchorDate: string;
  weekStartsOn: number;
  days: PatternDayInput[];
}

/** Cykeln får vara 1–8 veckor. Utanför det är det ett skrivfel, inte en avsikt. */
export const clampCycleWeeks = (n: number) => Math.min(8, Math.max(1, Math.round(n)));

/**
 * Ersätter en persons mönster.
 *
 * Raderar och skriver om i stället för att uppdatera: ett mönster är en
 * hel bild av veckan, och en halv uppdatering skulle lämna kvar dagar
 * som inte längre gäller. En tom dagslista betyder "inget mönster" och
 * lämnar personen utan — det är skillnaden mellan att inte jobba och
 * att vi inte vet.
 */
export async function writePattern(employeeId: string, input: PatternInput): Promise<void> {
  const db = getDb();
  const cycleWeeks = clampCycleWeeks(input.cycleWeeks);

  await db.delete(schema.workPattern).where(eq(schema.workPattern.employeeId, employeeId));
  if (input.days.length === 0) return;

  const [pattern] = await db
    .insert(schema.workPattern)
    .values({
      employeeId,
      cycleWeeks,
      anchorDate: input.anchorDate,
      weekStartsOn: input.weekStartsOn,
    })
    .returning();

  // Dagar utanför cykeln skulle aldrig kunna träffa och filtreras bort.
  const days = input.days.filter((d) => d.cycleWeek < cycleWeeks);
  if (days.length) {
    await db
      .insert(schema.workPatternDay)
      .values(days.map((d) => ({ ...d, workPatternId: pattern.id })))
      .onConflictDoNothing();
  }
}
