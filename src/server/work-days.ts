import { inArray } from "drizzle-orm";
import { type Db, getDb, schema } from "@/db";
import {
  CompositeWorkDayProvider,
  expandPatterns,
  type PatternDayLike,
  type PatternLike,
  type WorkDayProvider,
  type WorkDayResult,
} from "@/lib/work-days";
import { TranspaShiftProvider } from "./shift-provider";

/** Mönster som redan hämtats, så providern slipper fråga igen. */
export interface PrefetchedPatterns {
  patterns: PatternLike[];
  days: PatternDayLike[];
}

/**
 * Arbetsdagar ur mönstren i appen.
 *
 * Reservkällan tills TransPA kan leverera. Den täcker varje person som
 * har ett mönster — även när mönstret inte ger några dagar alls under
 * perioden, vilket är skillnaden mellan "ledig" och "vet inte".
 */
export class LocalPatternProvider implements WorkDayProvider {
  readonly name = "lokalt mönster";

  /**
   * `db`: egen koppling när providern körs utanför webbappen, t.ex. i
   * seed. `prefetched`: mönstren när anroparen redan hämtat dem —
   * tavelvyn gör det i sin samlingsfråga, och två turer till databasen
   * för uppgifter som redan ligger i minnet är ren väntan.
   */
  constructor(
    private readonly db?: Db,
    private readonly prefetched?: PrefetchedPatterns,
  ) {}

  async getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult> {
    if (employeeIds.length === 0) return { workDays: [], covered: [] };

    if (this.prefetched) {
      const { patterns, days } = this.prefetched;
      const mine = patterns.filter((p) => employeeIds.includes(p.employeeId));
      if (mine.length === 0) return { workDays: [], covered: [] };
      const ids = new Set(mine.map((p) => p.id));
      return {
        workDays: expandPatterns(mine, days.filter((d) => ids.has(d.workPatternId)), from, to),
        covered: [...new Set(mine.map((p) => p.employeeId))],
      };
    }

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
 * TransPA:s pass först, mönstren som reserv. Composite faller tillbaka
 * per person, så en person vars pass inte förts in i TransPA fortsätter
 * få sina dagar ur mönstret medan alla andra hämtas — övergången sker
 * en person i taget i stället för som ett omkast.
 *
 * Passhämtningen kopplas bort när TransPA-uppgifter saknas: i dev och i
 * seed finns inga, och ett anrop som ändå görs blir bara väntan på ett
 * fel. `db`-varianten används av skript utanför webbappen och läser
 * därför bara mönstren.
 */
export function getWorkDayProvider(db?: Db, prefetched?: PrefetchedPatterns): WorkDayProvider {
  const local = new LocalPatternProvider(db, prefetched);
  if (db || !process.env.TRANSPA_CLIENT_ID) return new CompositeWorkDayProvider([local]);
  return new CompositeWorkDayProvider([new TranspaShiftProvider(), local]);
}
