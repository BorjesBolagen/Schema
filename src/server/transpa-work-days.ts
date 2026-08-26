import "server-only";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import { credentialsForTenant } from "@/lib/transpa/auth";
import { batchByFilterLength, condition, joinConditions } from "@/lib/transpa/filter";
import { suggestPatterns, type PatternSuggestion, type TripLike } from "@/lib/trip-patterns";
import { writePattern } from "./patterns";

/**
 * Arbetsdagar och TransPA — vad som faktiskt går, och vad som inte gör det.
 *
 * Frågan är avgjord mot Börjes tenant (2026-08-26): TransPA:s Public API
 * levererar inga planerade pass. Samtliga vägar till shifts, scheman,
 * frånvaro, semester och tidrapporter svarar 404, även med ett riktigt
 * person-id insatt. Ett beviljat scope — `transpaapi:shifts:read` är
 * beviljat — betyder bara att Vismas katalog känner till namnet, inte
 * att resursen är exponerad.
 *
 * Därför finns ingen TranspaWorkDayProvider. Den vore en hämtning av
 * något som inte går att hämta. LocalPatternProvider är källan till
 * arbetsdagar, inte en reservlösning i väntan på något bättre.
 *
 * Det TransPA ändå kan bidra med är historik: /v1/trips bär körda turer
 * med employeeId och starttid. Ur några veckors turer går det att se
 * vilka dagar och vilket skift en person faktiskt kör, och föreslå ett
 * mönster utifrån det. Det är vad den här modulen gör — den föreslår,
 * planeraren bestämmer.
 */

/** Så långt bakåt turhistoriken läses när ett mönster ska föreslås. */
export const DEFAULT_WEEKS_BACK = 6;

export interface SuggestionReport {
  ok: boolean;
  weeksBack: number;
  /** Antal turer som lästes, över alla bolag. */
  trips: number;
  /** Personer förslaget frågades om. */
  asked: number;
  /** Av dem: hur många som har en TransPA-koppling att fråga om. */
  linked: number;
  /**
   * Av de kopplade: hur många som faktiskt hade någon tur i perioden.
   *
   * Det är den siffra som avgör om turhistoriken duger som underlag.
   * Ligger den nära noll bär /v1/trips inte arbetsdagar — fälten
   * allowanceReductions och borderCrossings pekar mot att en "tur" är
   * en traktamentsgrundande resa, inte ett arbetspass.
   */
  withTrips: number;
  suggestions: PatternSuggestion[];
  error?: string;
}

interface TranspaTrip {
  employeeId?: string;
  startDateTime?: string;
}

/**
 * Läser turhistoriken och föreslår arbetsmönster.
 *
 * Turerna hämtas per bolag, eftersom en token bara gäller en tenant.
 * Personerna slås upp lokalt först: förslagen ska gälla dem vi faktiskt
 * har i registret, och employeeId i TransPA är deras transpaId här.
 */
export async function suggestPatternsFromTrips(
  employeeIds: string[],
  weeksBack = DEFAULT_WEEKS_BACK,
  fetchImpl: typeof fetch = fetch,
): Promise<SuggestionReport> {
  const empty: SuggestionReport = {
    ok: true,
    weeksBack,
    trips: 0,
    asked: employeeIds.length,
    linked: 0,
    withTrips: 0,
    suggestions: [],
  };
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

  /* Bara personer som kommer från TransPA har turer att läsa. En
     handupplagd person har inget transpaId, och ska inte tas för att
     vara utan turer — hon är utan koppling. */
  const linked = people.filter((p) => p.transpaId && p.tenantId);
  if (linked.length === 0) return empty;
  empty.linked = linked.length;

  const byTranspaId = new Map(linked.map((p) => [p.transpaId!, p.id]));
  const byTenant = new Map<string, string[]>();
  for (const p of linked) {
    byTenant.set(p.tenantId!, [...(byTenant.get(p.tenantId!) ?? []), p.transpaId!]);
  }

  const tenants = await db
    .select({ id: schema.transpaTenant.id, tenantId: schema.transpaTenant.tenantId })
    .from(schema.transpaTenant)
    .where(inArray(schema.transpaTenant.id, [...byTenant.keys()]));

  const from = new Date(Date.now() - weeksBack * 7 * 86_400_000).toISOString();
  const to = new Date().toISOString();

  const collected: TripLike[] = [];
  for (const tenant of tenants) {
    const credentials = credentialsForTenant(tenant.tenantId);
    if (!credentials) continue;
    const ids = byTenant.get(tenant.id) ?? [];
    if (ids.length === 0) continue;

    const client = new TranspaClient({ credentials, fetchImpl });

    /* Filtret får vara högst 400 tecken, och ett GUID är 36 — listan
       spricker alltså redan vid sju personer. Uppdelningen mäter det
       färdiga filtret i stället för att gissa hur många som ryms. */
    const buildFilter = (batch: string[]) =>
      joinConditions([
        condition("employeeId", "in", batch),
        condition("startDateTime", "gte", from),
        condition("startDateTime", "lt", to),
      ]);

    try {
      for (const batch of batchByFilterLength(ids, buildFilter)) {
        const rows = await client.list<TranspaTrip>("/v1/trips", { filter: buildFilter(batch) });

        for (const row of rows) {
          const localId = row.employeeId ? byTranspaId.get(row.employeeId) : undefined;
          if (!localId || !row.startDateTime) continue;
          // Personen bärs vidare med sitt lokala id, så förslagen går
          // att koppla mot mönstertabellen utan ännu ett uppslag.
          collected.push({ employeeId: localId, startDateTime: row.startDateTime });
        }
      }
    } catch (error) {
      return {
        ...empty,
        ok: false,
        trips: collected.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    ...empty,
    ok: true,
    trips: collected.length,
    withTrips: new Set(collected.map((t) => t.employeeId)).size,
    suggestions: suggestPatterns(collected),
  };
}

/**
 * Skriver ett föreslaget mönster till en person.
 *
 * Cykellängden sätts till 1: turhistoriken kan visa vilka veckodagar
 * någon kör, men att skilja en fyraveckorscykel från oregelbundenhet
 * kräver mer underlag än vi har. Rullscheman läggs in för hand.
 */
export async function applySuggestion(
  employeeId: string,
  days: Array<{ weekday: number; shift: "day" | "night" }>,
): Promise<void> {
  await writePattern(employeeId, {
    cycleWeeks: 1,
    anchorDate: new Date().toISOString().slice(0, 10),
    weekStartsOn: 1,
    days: days.map((d) => ({ ...d, cycleWeek: 0 })),
  });
}
