import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import { credentialsForTenant } from "@/lib/transpa/auth";
import {
  SHIFTS_PATH,
  shiftWindow,
  workDaysFromShifts,
  type TranspaShift,
} from "@/lib/transpa/shifts";
import type { WorkDayProvider, WorkDayResult } from "@/lib/work-days";

/* Medvetet utan "server-only": modulen läses av getWorkDayProvider,
   som i sin tur importeras av seed-skriptet. Den rör inga cookies och
   inga server-actions — bara databasen och miljön, precis som
   LocalPatternProvider bredvid den. */

/**
 * Arbetsdagar hämtade ur TransPA:s pass.
 *
 * Vägen och parametrarna är bekräftade mot tenanten (2026-08-27):
 * /v1/shifts/ kräver startDateTimeAfter och startDateTimeBefore, och
 * svarar 404 utan dem. Hela bolagets pass hämtas i en fråga per bolag
 * och sorteras lokalt — 301 personer skulle annars bli 301 anrop.
 *
 * Den som inte har ett enda pass i fönstret lämnas otäckt, så
 * CompositeWorkDayProvider faller tillbaka på hens lokala mönster. Att
 * i stället tolka tystnad som ledighet skulle tömma tavlan för alla
 * vars pass ännu inte förts in i TransPA.
 */
export class TranspaShiftProvider implements WorkDayProvider {
  readonly name = "TransPA-pass";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult> {
    const empty: WorkDayResult = { workDays: [], covered: [] };
    if (employeeIds.length === 0) return empty;

    const db = getDb();
    const people = await db
      .select({
        id: schema.employee.id,
        transpaId: schema.employee.transpaId,
        tenantId: schema.employee.transpaTenantId,
      })
      .from(schema.employee)
      .where(inArray(schema.employee.id, employeeIds));

    const linked = people.filter((x) => x.transpaId && x.tenantId);
    if (linked.length === 0) return empty;

    const localFor = new Map(linked.map((x) => [x.transpaId!, x.id]));
    const tenantIds = [...new Set(linked.map((x) => x.tenantId!))];
    const tenants = await db
      .select({ id: schema.transpaTenant.id, tenantId: schema.transpaTenant.tenantId })
      .from(schema.transpaTenant)
      .where(inArray(schema.transpaTenant.id, tenantIds));

    const collected: TranspaShift[] = [];
    for (const tenant of tenants) {
      const credentials = credentialsForTenant(tenant.tenantId);
      if (!credentials) continue;

      const client = new TranspaClient({ credentials, fetchImpl: this.fetchImpl });
      /* Ett misslyckat anrop lämnar bolaget otäckt i stället för att
         fälla hela veckan — resten av tavlan ska fungera även när
         TransPA är nere. */
      try {
        collected.push(
          ...(await client.list<TranspaShift>(SHIFTS_PATH, { query: shiftWindow(from, to) })),
        );
      } catch {
        continue;
      }
    }

    return workDaysFromShifts(collected, (transpaId) => localFor.get(transpaId));
  }
}
