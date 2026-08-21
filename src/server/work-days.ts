import { inArray } from "drizzle-orm";
import { type Db, getDb, schema } from "@/db";
import {
  CompositeWorkDayProvider,
  expandPatterns,
  type WorkDayProvider,
  type WorkDayResult,
} from "@/lib/work-days";

/**
 * Arbetsdagar ur mönstren i appen.
 *
 * Reservkällan tills TransPA kan leverera. Den täcker varje person som
 * har ett mönster — även när mönstret inte ger några dagar alls under
 * perioden, vilket är skillnaden mellan "ledig" och "vet inte".
 */
export class LocalPatternProvider implements WorkDayProvider {
  readonly name = "lokalt mönster";

  /** Egen koppling när providern körs utanför webbappen, t.ex. i seed. */
  constructor(private readonly db?: Db) {}

  async getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult> {
    if (employeeIds.length === 0) return { workDays: [], covered: [] };
    const db = this.db ?? getDb();

    const patterns = await db
      .select()
      .from(schema.workPattern)
      .where(inArray(schema.workPattern.employeeId, employeeIds));
    if (patterns.length === 0) return { workDays: [], covered: [] };

    const days = await db
      .select()
      .from(schema.workPatternDay)
      .where(
        inArray(
          schema.workPatternDay.workPatternId,
          patterns.map((p) => p.id),
        ),
      );

    return {
      workDays: expandPatterns(patterns, days, from, to),
      covered: [...new Set(patterns.map((p) => p.employeeId))],
    };
  }
}

/**
 * Källan appen läser arbetsdagar ur.
 *
 * TransPA läggs först i kedjan så snart hämtningen finns; composite
 * faller tillbaka på mönstren per person, så övergången kan ske en
 * person i taget.
 */
export function getWorkDayProvider(db?: Db): WorkDayProvider {
  return new CompositeWorkDayProvider([new LocalPatternProvider(db)]);
}
