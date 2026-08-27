import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import {
  SHIFTS_PATH,
  shiftToWorkDay,
  shiftWindow,
  splitIntoWindows,
  type TranspaShift,
} from "@/lib/transpa/shifts";
import { withBudget } from "./shift-provider";
import { READ_SCOPES, credentialsForTenant, credentialsFromEnv } from "@/lib/transpa/auth";

/**
 * Synk av grunddata från TransPA.
 *
 * Rör bara endpoints Visma dokumenterat. Lokalt ägda fält skrivs aldrig
 * över: vehicle.displayName är vad *ni* kallar bilen, och
 * employee.stationPlaceId sätts i appen så länge TransPA:s Employee inte
 * bär någon stationsort.
 */

/**
 * Fönstret passen hämtas för.
 *
 * Fyra veckor bakåt och tolv framåt: bakåt så en vecka som redan
 * passerat går att öppna, framåt så planeringen når ett kvartal. Hela
 * fönstret i en fråga per bolag — 301 personer skulle annars bli 301
 * anrop.
 */
const SHIFT_WEEKS_BACK = 4;
const SHIFT_WEEKS_AHEAD = 12;

/** Synken får ta längre tid än en sidrendering; den väntar ingen på. */
const SYNC_TIMEOUT_MS = 30_000;

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const shiftWindowStart = () => isoDay(-SHIFT_WEEKS_BACK * 7);
const shiftWindowEnd = () => isoDay(SHIFT_WEEKS_AHEAD * 7);

interface TranspaStationPlace {
  id?: string;
  name?: string;
  supervisorPhoneNumber?: string;
  emergencyPhoneNumber?: string;
}
interface TranspaEmployee {
  id?: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: number | string;
  signature?: string;
  professionGroup?: string;
  isActive?: boolean;
}

export interface ResourceResult {
  resource: string;
  fetched: number;
  written: number;
  error?: string;
  /** Sant när resursen hoppades över för att scopet inte är beviljat. */
  skipped?: boolean;
}

/**
 * Vilket scope varje resurs kräver.
 *
 * Synken frågar aldrig efter något ni saknar tillstånd till — annars
 * blir det 403 vid varje körning, utan att det går att åtgärda.
 * Kontrollen läser ur READ_SCOPES, så listan hålls ihop av sig själv
 * när fler scopes beviljas.
 */
const SCOPE_FOR: Record<string, string> = {
  stationPlaces: "transpaapi:stationplaces:read",
  employees: "transpaapi:employees:read",
  shifts: "transpaapi:shifts:read",
};

const granted = (resource: string) => READ_SCOPES.includes(SCOPE_FOR[resource] ?? "");

export interface SyncResult {
  ok: boolean;
  results: ResourceResult[];
  ranAt: string;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/**
 * `key` avgör scopet, `label` är vad som visas.
 *
 * De skiljs åt därför att etiketten bär bolagets namn när flera bolag
 * synkas — utan uppdelningen skulle scope-uppslaget söka på
 * "employees · Bolag 1" och aldrig hitta något.
 */
async function track(
  db: Db,
  key: string,
  label: string,
  run: () => Promise<{ fetched: number; written: number }>,
): Promise<ResourceResult> {
  if (!granted(key)) {
    return {
      resource: label,
      fetched: 0,
      written: 0,
      skipped: true,
      error: `Hoppades över — scopet ${SCOPE_FOR[key]} är inte beviljat.`,
    };
  }

  const [row] = await db.insert(schema.syncRun).values({ resource: label }).returning();
  try {
    const { fetched, written } = await run();
    await db
      .update(schema.syncRun)
      .set({ status: "ok", itemCount: written, finishedAt: new Date() })
      .where(eq(schema.syncRun.id, row.id));
    return { resource: label, fetched, written };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.syncRun)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(schema.syncRun.id, row.id));
    return { resource: label, fetched: 0, written: 0, error: message };
  }
}

/**
 * Bolagen som ska synkas.
 *
 * Registret ligger i databasen så bolagen kan få begripliga namn — ett
 * tenant-id duger inte i en meny. Är det tomt men TRANSPA_TENANT_ID satt
 * läggs det bolaget upp automatiskt, så första körningen fungerar utan
 * att någon behöver fylla i något först.
 */
async function tenantsToSync(db: Db): Promise<Array<{ id: string; tenantId: string; name: string }>> {
  const existing = await db
    .select()
    .from(schema.transpaTenant)
    .where(eq(schema.transpaTenant.isActive, true));
  if (existing.length > 0) {
    return existing.map((t) => ({ id: t.id, tenantId: t.tenantId, name: t.name }));
  }

  const fromEnv = process.env.TRANSPA_TENANT_ID;
  if (!fromEnv) return [];

  const [row] = await db
    .insert(schema.transpaTenant)
    .values({ tenantId: fromEnv, name: "Bolag 1" })
    .onConflictDoNothing({ target: schema.transpaTenant.tenantId })
    .returning();
  return row ? [{ id: row.id, tenantId: row.tenantId, name: row.name }] : [];
}

/**
 * Synkar personal och stationsorter, ett bolag i taget.
 *
 * Fordon hämtas medvetet inte: de skrivs in för hand i verktyget. Det
 * kan ändras senare, men i dag äger ni bilnumren själva och TransPA:s
 * fordonsregister tillför inget.
 */
export async function syncBaseData(fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const ranAt = new Date().toISOString();
  const db = getDb();

  if (!credentialsFromEnv() && !process.env.TRANSPA_CLIENT_ID) {
    return {
      ok: false,
      ranAt,
      results: [{ resource: "alla", fetched: 0, written: 0, error: "Inga TransPA-uppgifter inlagda." }],
    };
  }

  const tenants = await tenantsToSync(db);
  if (tenants.length === 0) {
    return {
      ok: false,
      ranAt,
      results: [{ resource: "alla", fetched: 0, written: 0, error: "Inget bolag att synka." }],
    };
  }

  const results: ResourceResult[] = [];
  for (const tenant of tenants) {
    const credentials = credentialsForTenant(tenant.tenantId);
    if (!credentials) continue;
    const client = new TranspaClient({ credentials, fetchImpl });
    results.push(...(await syncTenant(db, client, tenant)));
  }

  return { ok: results.every((r) => r.skipped || !r.error), results, ranAt };
}

async function syncTenant(
  db: Db,
  client: TranspaClient,
  tenant: { id: string; name: string },
): Promise<ResourceResult[]> {
  const results: ResourceResult[] = [];

  results.push(
    await track(db, "stationPlaces", `stationsorter · ${tenant.name}`, async () => {
      const rows = await client.list<TranspaStationPlace>("/v1/stationPlaces");
      const values = rows
        .filter((r) => r.id && r.name)
        .map((r) => ({
          transpaId: String(r.id),
          name: r.name!,
          supervisorPhoneNumber: str(r.supervisorPhoneNumber),
          emergencyPhoneNumber: str(r.emergencyPhoneNumber),
        }));
      if (values.length) {
        await db
          .insert(schema.stationPlace)
          .values(values)
          .onConflictDoUpdate({
            target: schema.stationPlace.transpaId,
            set: {
              name: sql`excluded.name`,
              supervisorPhoneNumber: sql`excluded.supervisor_phone_number`,
              emergencyPhoneNumber: sql`excluded.emergency_phone_number`,
            },
          });
      }
      return { fetched: rows.length, written: values.length };
    }),
  );

  results.push(
    await track(db, "employees", `personal · ${tenant.name}`, async () => {
      const rows = await client.list<TranspaEmployee>("/v1/employees");
      const values = rows
        .filter((r) => r.id && (r.firstName || r.lastName))
        .map((r) => ({
          transpaId: String(r.id),
          employeeNumber: str(r.employeeNumber),
          firstName: r.firstName ?? "",
          lastName: r.lastName ?? "",
          signature: str(r.signature),
          professionGroup: str(r.professionGroup),
          isActive: r.isActive ?? true,
          transpaTenantId: tenant.id,
        }));

      if (values.length) {
        await db
          .insert(schema.employee)
          .values(values)
          .onConflictDoUpdate({
            target: schema.employee.transpaId,
            // stationPlaceId rörs inte: TransPA:s Employee bär ingen
            // stationsort, så den sätts i appen och ska inte nollas här.
            set: {
              employeeNumber: sql`excluded.employee_number`,
              firstName: sql`excluded.first_name`,
              lastName: sql`excluded.last_name`,
              signature: sql`excluded.signature`,
              professionGroup: sql`excluded.profession_group`,
              isActive: sql`excluded.is_active`,
              updatedAt: new Date(),
            },
          });
      }
      return { fetched: rows.length, written: values.length };
    }),
  );

  results.push(
    await track(db, "shifts", `pass · ${tenant.name}`, async () => {
      /* Personerna måste finnas först — ett pass utan känd person går
         inte att lagra, och synken ovan körde precis. */
      const people = await db
        .select({ id: schema.employee.id, transpaId: schema.employee.transpaId })
        .from(schema.employee)
        .where(eq(schema.employee.transpaTenantId, tenant.id));
      const localFor = new Map(
        people.filter((x) => x.transpaId).map((x) => [x.transpaId!, x.id]),
      );
      if (localFor.size === 0) return { fetched: 0, written: 0 };

      /* TransPA tar högst 31 dagar per anrop, så fönstret delas upp.
         Bitarna gränsar exakt: varken glapp som tappar pass eller
         överlapp som hämtar dem två gånger. */
      const rows: TranspaShift[] = [];
      for (const window of splitIntoWindows(shiftWindowStart(), shiftWindowEnd())) {
        rows.push(
          ...(await withBudget(
            (signal) =>
              client.list<TranspaShift>(SHIFTS_PATH, {
                query: shiftWindow(window.from, window.to),
                signal,
              }),
            SYNC_TIMEOUT_MS,
          )),
        );
      }

      const values = rows
        .flatMap((raw) => {
          const localId = raw.employeeId ? localFor.get(raw.employeeId) : undefined;
          if (!localId || !raw.id) return [];
          const day = shiftToWorkDay(raw, localId);
          if (!day) return [];
          return [
            {
              transpaId: String(raw.id),
              employeeId: localId,
              date: day.date,
              shift: day.shift,
              startsAt: new Date(raw.startDateTime!),
              workMinutes: raw.adjustedWorkTimeInMinutes ?? null,
              isExtraShift: raw.isExtraShift ?? false,
              name: str(raw.name),
              syncedAt: new Date(),
            },
          ];
        })
        // Samma pass två gånger i ett svar skulle fälla insert:en.
        .filter((v, i, all) => all.findIndex((x) => x.transpaId === v.transpaId) === i);

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
      return { fetched: rows.length, written: values.length };
    }),
  );

  return results;
}
