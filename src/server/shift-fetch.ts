import "server-only";
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import { credentialsForTenant } from "@/lib/transpa/auth";
import { attributeShifts, shiftWindow, type TranspaShift } from "@/lib/transpa/shifts";
import { withBudget } from "./shift-provider";

/**
 * Hämtar en veckas pass, en person i taget.
 *
 * Formen är vald efter hur verktyget faktiskt används. Ett svep över
 * hela bolaget och ett kvartal framåt lät effektivt men var fel: det
 * hämtade tusentals pass ingen bett om, sprängde TransPA:s gräns på 31
 * dagar per anrop, och gjorde ändå inte den vecka man tittar på
 * färskare. Här hämtas precis den vecka som visas, för precis de
 * personer tavlan hanterar, när någon ber om det.
 *
 * En vecka ligger med god marginal under 31-dagarsgränsen, så ingen
 * uppdelning behövs.
 */

export interface ShiftFetchResult {
  ok: boolean;
  /** Personer vi frågade TransPA om. */
  asked: number;
  /** Av dem: hur många som hade pass i veckan. */
  withShifts: number;
  /** Pass som skrevs. */
  shifts: number;
  /** Personer utan TransPA-koppling — de kan inte frågas om. */
  unlinked: number;
  /** Personer där anropet misslyckades, med första felet. */
  failed: number;
  error?: string;
}

/** Per person, så en trög person inte drar med sig hela veckan. */
const PER_PERSON_TIMEOUT_MS = 10_000;

export async function fetchWeekShifts(
  employeeIds: string[],
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
  /** Egen koppling när hämtningen körs utanför webbappen, t.ex. i test. */
  dbOverride?: Db,
): Promise<ShiftFetchResult> {
  const empty: ShiftFetchResult = {
    ok: true,
    asked: 0,
    withShifts: 0,
    shifts: 0,
    unlinked: 0,
    failed: 0,
  };
  if (employeeIds.length === 0) return empty;

  const db = dbOverride ?? getDb();
  const people = await db
    .select({
      id: schema.employee.id,
      transpaId: schema.employee.transpaId,
      tenantId: schema.employee.transpaTenantId,
    })
    .from(schema.employee)
    .where(inArray(schema.employee.id, employeeIds));

  const linked = people.filter((x) => x.transpaId && x.tenantId);
  empty.unlinked = employeeIds.length - linked.length;
  if (linked.length === 0) return { ...empty, ok: false, error: "Ingen är kopplad till TransPA." };

  /* Klient-id och hemlighet delas av bolagen; bara tenanten skiljer, så
     en klient per bolag räcker. */
  const tenants = await db
    .select({ id: schema.transpaTenant.id, tenantId: schema.transpaTenant.tenantId })
    .from(schema.transpaTenant)
    .where(inArray(schema.transpaTenant.id, [...new Set(linked.map((x) => x.tenantId!))]));

  const clients = new Map<string, TranspaClient>();
  for (const tenant of tenants) {
    const credentials = credentialsForTenant(tenant.tenantId);
    if (credentials) clients.set(tenant.id, new TranspaClient({ credentials, fetchImpl }));
  }

  const query = shiftWindow(from, to);
  const values: Array<typeof schema.transpaShift.$inferInsert> = [];
  const withShifts = new Set<string>();
  const failedFor = new Set<string>();
  let firstError: string | undefined;

  for (const person of linked) {
    const client = clients.get(person.tenantId!);
    if (!client) continue;

    try {
      const rows = await withBudget(
        (signal) =>
          client.list<TranspaShift>(`/v1/employees/${person.transpaId}/shifts/`, {
            query,
            signal,
          }),
        PER_PERSON_TIMEOUT_MS,
      );

      /* Passen läses i ordning och inte var för sig: en natt som TransPA
         delat i två poster ska landa på en arbetsdag, inte på två. */
      for (const { shift: raw, day } of attributeShifts(rows, person.id)) {
        if (!raw.id) continue;
        withShifts.add(person.id);
        values.push({
          transpaId: String(raw.id),
          employeeId: person.id,
          date: day.date,
          shift: day.shift,
          startsAt: new Date(raw.startDateTime!),
          workMinutes: raw.adjustedWorkTimeInMinutes ?? null,
          isExtraShift: raw.isExtraShift ?? false,
          name: raw.name ?? null,
          syncedAt: new Date(),
        });
      }
    } catch (error) {
      /* En person som fallerar ska inte fälla resten av veckan. Felet
         redovisas, de andra hämtas färdigt — och hens gamla pass står
         kvar, eftersom vi inte vet att de är borta. */
      failedFor.add(person.id);
      firstError ??= error instanceof Error ? error.message : String(error);
    }
  }

  /* Veckans tidigare pass för just de här personerna tas bort först.
     Annars blir ett pass som strukits i TransPA kvar hos oss för
     alltid — en upsert kan ersätta, aldrig städa. Avgränsat till
     personerna och veckan, så inget annat rörs. */
  const fetched = linked.filter((p) => !failedFor.has(p.id)).map((p) => p.id);
  if (fetched.length > 0) {
    await db
      .delete(schema.transpaShift)
      .where(
        and(
          inArray(schema.transpaShift.employeeId, fetched),
          gte(schema.transpaShift.date, from),
          lte(schema.transpaShift.date, to),
        ),
      );
  }

  if (values.length) {
    await db
      .insert(schema.transpaShift)
      .values(values)
      .onConflictDoUpdate({
        target: schema.transpaShift.transpaId,
        set: {
          employeeId: sql`excluded.employee_id`,
          date: sql`excluded.date`,
          shift: sql`excluded.shift`,
          startsAt: sql`excluded.starts_at`,
          workMinutes: sql`excluded.work_minutes`,
          isExtraShift: sql`excluded.is_extra_shift`,
          name: sql`excluded.name`,
          syncedAt: new Date(),
        },
      });
  }

  return {
    ok: failedFor.size < linked.length,
    asked: linked.length,
    withShifts: withShifts.size,
    shifts: values.length,
    unlinked: empty.unlinked,
    failed: failedFor.size,
    error: firstError,
  };
}
