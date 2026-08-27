import { and, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import { credentialsForTenant } from "@/lib/transpa/auth";
import {
  SHIFTS_PATH,
  shiftWindow,
  workDayFromStored,
  workDaysFromShifts,
  type TranspaShift,
} from "@/lib/transpa/shifts";
import { addDays } from "@/lib/week";
import type { WorkDay, WorkDayProvider, WorkDayResult } from "@/lib/work-days";

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
/**
 * Hur länge passhämtningen får ta innan mönstren tar över.
 *
 * Tavelvyn ligger bakom en databastidsgräns på sex sekunder, och den
 * här hämtningen körs inuti den. Ett långsamt eller nedliggande TransPA
 * fick därför hela sidan att falla med "Databasanropet svarade inte
 * inom 6 sekunder" — ett fel som pekar på fel sak och som pensionerar
 * en databasanslutning som var oskyldig. Taket här ska ligga med god
 * marginal under sidans.
 */
const SHIFT_TIMEOUT_MS = 3_000;

/** Så länge ett hämtat fönster återanvänds. */
const CACHE_MS = 60_000;

interface CachedWindow {
  at: number;
  shifts: TranspaShift[];
}

/* På globalThis av samma skäl som databaskopplingen: Next bygger sidor
   och server-actions i skilda modulgrafer, och en modullokal cache
   skulle betyda en hämtning per graf. */
const CACHE_KEY = Symbol.for("schema.transpa.shiftWindows");
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: Map<string, CachedWindow> };

function windowCache(): Map<string, CachedWindow> {
  const g = globalThis as GlobalWithCache;
  g[CACHE_KEY] ??= new Map();
  return g[CACHE_KEY];
}

/**
 * Arbetsdagar ur de synkade passen.
 *
 * Läser bara databasen, så den kan ligga i tavelvyns renderingsväg utan
 * att ett trögt TransPA kan fälla sidan. Hämtningen från API:t sköts av
 * synken, precis som för personal och stationsorter.
 *
 * Den som saknar pass i fönstret lämnas otäckt och faller tillbaka på
 * sitt lokala mönster. Att tolka tystnad som ledighet skulle tömma
 * tavlan för alla vars pass ännu inte förts in i TransPA.
 */
/* Ett dygns marginal åt vardera hållet när det grovsållas på den
   sparade date-kolumnen: den bär en gammal tolkning och kan peka på
   dagen före eller efter den passet verkligen hör till. */
const dagFore = (iso: string) => addDays(iso, -1);
const dagEfter = (iso: string) => addDays(iso, 1);

export class SyncedShiftProvider implements WorkDayProvider {
  readonly name = "TransPA-pass";

  constructor(private readonly db?: Db) {}

  async getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult> {
    if (employeeIds.length === 0) return { workDays: [], covered: [] };

    /* Den sparade date-kolumnen används bara för att grovsålla, med ett
       dygns marginal: den är en gammal tolkning och kan peka på fel dag.
       Vilken dag passet verkligen hör till avgörs nedan. */
    const rows = await (this.db ?? getDb())
      .select({
        employeeId: schema.transpaShift.employeeId,
        startsAt: schema.transpaShift.startsAt,
        endsAt: schema.transpaShift.endsAt,
        workMinutes: schema.transpaShift.workMinutes,
      })
      .from(schema.transpaShift)
      .where(
        and(
          inArray(schema.transpaShift.employeeId, employeeIds),
          gte(schema.transpaShift.date, dagFore(from)),
          lte(schema.transpaShift.date, dagEfter(to)),
        ),
      );

    /* Tolkningen görs om här, inte vid hämtningen. Datum och skift är
       härledda värden; ändras regeln som härleder dem blir varje sparad
       rad tyst fel, och den som tittar på tavlan ser en gammal tolkning
       utan att veta om det. Det hände: nattpass fortsatte visas som
       dagpass efter att regeln rättats, ända tills någon råkade hämta om
       veckan.

       Två pass samma dag och skift — delat pass eller extrapass — är
       fortfarande en arbetsdag. */
    const seen = new Set<string>();
    const workDays: WorkDay[] = [];
    const covered = new Set<string>();

    for (const row of rows) {
      covered.add(row.employeeId);
      const day = workDayFromStored(row);
      if (day.date < from || day.date > to) continue;
      const key = `${day.employeeId}|${day.date}|${day.shift}`;
      if (seen.has(key)) continue;
      seen.add(key);
      workDays.push(day);
    }

    return { workDays, covered: [...covered] };
  }
}

/**
 * Kör något med ett hårt tak, och avbryt det som pågår.
 *
 * Både avbrott och kapplöpning behövs: signalen stänger uttaget så
 * anropet inte lever vidare, och kapplöpningen håller taket även för
 * token-hämtningen, som inte tar någon signal.
 */
export async function withBudget<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const abort = new AbortController();
  let bell: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(abort.signal),
      new Promise<never>((_, reject) => {
        bell = setTimeout(() => {
          abort.abort();
          reject(new Error(`Svarade inte inom ${ms} ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (bell) clearTimeout(bell);
  }
}

export class TranspaShiftProvider implements WorkDayProvider {
  readonly name = "TransPA-pass";

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = SHIFT_TIMEOUT_MS,
  ) {}

  /**
   * Aldrig kastar, alltid inom sin tidsgräns.
   *
   * Källan är en av två i kedjan, och den andra klarar sig utan den.
   * Att låta ett fel härifrån bubbla upp vore att låta en reserv fälla
   * det den är reserv för — vilket är precis vad som hände när ett
   * långsamt TransPA gav "Databasanropet svarade inte inom 6 sekunder"
   * på hela tavelvyn.
   */
  async getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult> {
    try {
      return await this.fetch(employeeIds, from, to);
    } catch {
      return { workDays: [], covered: [] };
    }
  }

  private async fetch(
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<WorkDayResult> {
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

      /* Ett fönster som redan hämtats återanvänds en kort stund. Utan
         det gör varje sidladdning och varje serverrendering om samma
         anrop, och tavelvyn renderas ofta flera gånger per besök. */
      const key = `${tenant.tenantId}|${from}|${to}`;
      const hit = windowCache().get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) {
        collected.push(...hit.shifts);
        continue;
      }

      const client = new TranspaClient({ credentials, fetchImpl: this.fetchImpl });

      /* Ett misslyckat eller långsamt anrop lämnar bolaget otäckt i
         stället för att fälla hela veckan — resten av tavlan ska
         fungera även när TransPA är nere, och mönstren tar över. */
      try {
        const shifts = await withBudget(
          (signal) => client.list<TranspaShift>(SHIFTS_PATH, { query: shiftWindow(from, to), signal }),
          this.timeoutMs,
        );
        windowCache().set(key, { at: Date.now(), shifts });
        collected.push(...shifts);
      } catch {
        continue;
      }
    }

    return workDaysFromShifts(collected, (transpaId) => localFor.get(transpaId));
  }
}
