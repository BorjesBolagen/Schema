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
import { SyncedShiftProvider } from "./shift-provider";

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
 * Bara lokala källor. Tavelvyn ligger bakom en databastidsgräns, och
 * ett nätanrop i renderingsvägen gjorde att ett trögt TransPA fällde
 * hela sidan med "Databasanropet svarade inte inom 6 sekunder" — ett
 * fel som pekar på fel sak.
 *
 * Passen från TransPA hämtas i stället i synken, till en egen tabell,
 * och läses därifrån som vilken lokal källa som helst. Samma väg som
 * personal och stationsorter redan går.
 */
export function getWorkDayProvider(db?: Db, prefetched?: PrefetchedPatterns): WorkDayProvider {
  return new CompositeWorkDayProvider([
    new SyncedShiftProvider(db),
    new LocalPatternProvider(db, prefetched),
  ]);
}
