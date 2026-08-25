import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import { READ_SCOPES, credentialsFromEnv } from "@/lib/transpa/auth";

/**
 * Synk av grunddata från TransPA.
 *
 * Rör bara endpoints Visma dokumenterat. Lokalt ägda fält skrivs aldrig
 * över: vehicle.displayName är vad *ni* kallar bilen, och
 * employee.stationPlaceId sätts i appen så länge TransPA:s Employee inte
 * bär någon stationsort.
 */

interface TranspaTrafficArea { id?: string; name?: string }
interface TranspaStationPlace {
  id?: string;
  name?: string;
  supervisorPhoneNumber?: string;
  emergencyPhoneNumber?: string;
}
interface TranspaVehicleGroup { id?: string; name?: string }
interface TranspaVehicle {
  id?: string;
  registrationNumber?: string;
  externalId?: string;
  isActive?: boolean;
  trafficAreaId?: number | string | null;
  stationPlaceId?: number | string | null;
  vehicleGroupId?: number | string | null;
}
interface TranspaEmployee {
  id?: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: number | string;
  signature?: string;
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
 * Synken hämtar bara det ni faktiskt har tillstånd till. Börjes
 * beviljade lista saknar `trafficareas` och `vehiclegroups` — de fanns
 * i Vismas föråldrade klient men har inga scopes — och utan den här
 * kontrollen skulle de misslyckas med 403 vid varje körning och skräpa
 * ner resultatet med fel som inte går att åtgärda.
 *
 * Får ni fler scopes beviljade räcker det att lägga till dem i
 * READ_SCOPES; synken plockar upp dem härifrån.
 */
const SCOPE_FOR: Record<string, string> = {
  trafficAreas: "transpaapi:trafficareas:read",
  stationPlaces: "transpaapi:stationplaces:read",
  vehicleGroups: "transpaapi:vehiclegroups:read",
  vehicles: "transpaapi:vehicles:read",
  employees: "transpaapi:employees:read",
};

const granted = (resource: string) => READ_SCOPES.includes(SCOPE_FOR[resource] ?? "");

export interface SyncResult {
  ok: boolean;
  results: ResourceResult[];
  ranAt: string;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

async function track(
  db: Db,
  resource: string,
  run: () => Promise<{ fetched: number; written: number }>,
): Promise<ResourceResult> {
  if (!granted(resource)) {
    return {
      resource,
      fetched: 0,
      written: 0,
      skipped: true,
      error: `Hoppades över — scopet ${SCOPE_FOR[resource]} är inte beviljat.`,
    };
  }

  const [row] = await db.insert(schema.syncRun).values({ resource }).returning();
  try {
    const { fetched, written } = await run();
    await db
      .update(schema.syncRun)
      .set({ status: "ok", itemCount: written, finishedAt: new Date() })
      .where(eq(schema.syncRun.id, row.id));
    return { resource, fetched, written };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.syncRun)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(schema.syncRun.id, row.id));
    return { resource, fetched: 0, written: 0, error: message };
  }
}

export async function syncBaseData(fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const ranAt = new Date().toISOString();
  const credentials = credentialsFromEnv();
  if (!credentials) {
    return {
      ok: false,
      ranAt,
      results: [{ resource: "alla", fetched: 0, written: 0, error: "Inga TransPA-uppgifter inlagda." }],
    };
  }

  const db = getDb();
  const client = new TranspaClient({ credentials, fetchImpl });
  const results: ResourceResult[] = [];

  results.push(
    await track(db, "trafficAreas", async () => {
      const rows = await client.list<TranspaTrafficArea>("/v1/trafficAreas");
      const values = rows
        .filter((r) => r.id && r.name)
        .map((r) => ({ transpaId: String(r.id), name: r.name! }));
      if (values.length) {
        await db
          .insert(schema.trafficArea)
          .values(values)
          .onConflictDoUpdate({
            target: schema.trafficArea.transpaId,
            set: { name: sql`excluded.name` },
          });
      }
      return { fetched: rows.length, written: values.length };
    }),
  );

  results.push(
    await track(db, "stationPlaces", async () => {
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
    await track(db, "vehicleGroups", async () => {
      const rows = await client.list<TranspaVehicleGroup>("/v1/vehicleGroups");
      const values = rows
        .filter((r) => r.id && r.name)
        .map((r) => ({ transpaId: String(r.id), name: r.name! }));
      if (values.length) {
        await db
          .insert(schema.vehicleGroup)
          .values(values)
          .onConflictDoUpdate({
            target: schema.vehicleGroup.transpaId,
            set: { name: sql`excluded.name` },
          });
      }
      return { fetched: rows.length, written: values.length };
    }),
  );

  results.push(
    await track(db, "vehicles", async () => {
      const rows = await client.list<TranspaVehicle>("/v1/vehicles");
      // Seriellt, inte parallellt — se kommentaren i board-week.ts.
      const areas = await db.select().from(schema.trafficArea);
      const places = await db.select().from(schema.stationPlace);
      const groups = await db.select().from(schema.vehicleGroup);
      const areaBy = new Map(areas.map((a) => [a.transpaId, a.id]));
      const placeBy = new Map(places.map((p) => [p.transpaId, p.id]));
      const groupBy = new Map(groups.map((g) => [g.transpaId, g.id]));

      const values = rows
        .filter((r) => r.id)
        .map((r) => ({
          transpaId: String(r.id),
          registrationNumber: str(r.registrationNumber),
          externalId: str(r.externalId),
          // Bara vid nyinlägg — se set-satsen nedan.
          displayName: str(r.externalId) ?? str(r.registrationNumber) ?? String(r.id),
          isActive: r.isActive ?? true,
          trafficAreaId: areaBy.get(str(r.trafficAreaId) ?? "") ?? null,
          stationPlaceId: placeBy.get(str(r.stationPlaceId) ?? "") ?? null,
          vehicleGroupId: groupBy.get(str(r.vehicleGroupId) ?? "") ?? null,
        }));

      if (values.length) {
        await db
          .insert(schema.vehicle)
          .values(values)
          .onConflictDoUpdate({
            target: schema.vehicle.transpaId,
            // displayName utelämnas medvetet: namnet ägs lokalt.
            set: {
              registrationNumber: sql`excluded.registration_number`,
              externalId: sql`excluded.external_id`,
              isActive: sql`excluded.is_active`,
              trafficAreaId: sql`excluded.traffic_area_id`,
              stationPlaceId: sql`excluded.station_place_id`,
              vehicleGroupId: sql`excluded.vehicle_group_id`,
              updatedAt: new Date(),
            },
          });
      }
      return { fetched: rows.length, written: values.length };
    }),
  );

  results.push(
    await track(db, "employees", async () => {
      const rows = await client.list<TranspaEmployee>("/v1/employees");
      const values = rows
        .filter((r) => r.id && (r.firstName || r.lastName))
        .map((r) => ({
          transpaId: String(r.id),
          employeeNumber: str(r.employeeNumber),
          firstName: r.firstName ?? "",
          lastName: r.lastName ?? "",
          signature: str(r.signature),
          isActive: r.isActive ?? true,
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
              isActive: sql`excluded.is_active`,
              updatedAt: new Date(),
            },
          });
      }
      return { fetched: rows.length, written: values.length };
    }),
  );

  // Överhoppad är inte misslyckad: resursen har inget scope och kommer
  // aldrig att gå att hämta, så den ska inte färga hela körningen röd.
  return { ok: results.every((r) => r.skipped || !r.error), results, ranAt };
}
