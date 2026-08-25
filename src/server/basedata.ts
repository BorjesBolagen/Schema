import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema, readWithTimeout } from "@/db";

/**
 * Grunddata — personal, fordon och stationsorter.
 *
 * Sanningen om personal och fordon ska komma från TransPA-synken. Den
 * här vägen finns ändå av två skäl: tills API-kopplingen är på plats
 * går det annars inte att lägga upp någonting alls, och efteråt finns
 * det alltid någon som ska med i schemat innan hen finns i TransPA.
 *
 * Rader som synken äger känns igen på transpaId. Synken skriver aldrig
 * över displayName eller stationPlaceId, men namn och anställningsnummer
 * på en synkad person hämtas om vid nästa körning — det står i vyn.
 */

export type BaseDataResult = { ok: true } | { ok: false; error: string };

export interface ManagedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  stationPlaceId: string | null;
  isActive: boolean;
  fromTranspa: boolean;
}

export interface ManagedVehicle {
  id: string;
  displayName: string;
  registrationNumber: string | null;
  stationPlaceId: string | null;
  isActive: boolean;
  fromTranspa: boolean;
}

export interface ManagedStation {
  id: string;
  name: string;
  fromTranspa: boolean;
}

export async function listStations(): Promise<ManagedStation[]> {
  const rows = await readWithTimeout(() =>
    getDb().select().from(schema.stationPlace).orderBy(asc(schema.stationPlace.name)),
  );
  return rows.map((s) => ({ id: s.id, name: s.name, fromTranspa: !!s.transpaId }));
}

export async function listEmployees(): Promise<ManagedEmployee[]> {
  const rows = await readWithTimeout(() =>
    getDb().select().from(schema.employee).orderBy(asc(schema.employee.lastName), asc(schema.employee.firstName)),
  );
  return rows.map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    employeeNumber: e.employeeNumber,
    stationPlaceId: e.stationPlaceId,
    isActive: e.isActive,
    fromTranspa: !!e.transpaId,
  }));
}

export async function listVehicles(): Promise<ManagedVehicle[]> {
  const rows = await readWithTimeout(() =>
    getDb().select().from(schema.vehicle).orderBy(asc(schema.vehicle.displayName)),
  );
  return rows.map((v) => ({
    id: v.id,
    displayName: v.displayName,
    registrationNumber: v.registrationNumber,
    stationPlaceId: v.stationPlaceId,
    isActive: v.isActive,
    fromTranspa: !!v.transpaId,
  }));
}

/* ------------------------------------------------------------------ *
 * Stationsorter
 * ------------------------------------------------------------------ */

export async function addStation(name: string): Promise<BaseDataResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Orten behöver ett namn." };

  const existing = await listStations();
  if (existing.some((s) => s.name.toLocaleLowerCase("sv") === trimmed.toLocaleLowerCase("sv"))) {
    return { ok: false, error: `${trimmed} finns redan.` };
  }
  await getDb().insert(schema.stationPlace).values({ name: trimmed });
  return { ok: true };
}

export async function renameStation(id: string, name: string): Promise<BaseDataResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Orten behöver ett namn." };
  await getDb().update(schema.stationPlace).set({ name: trimmed }).where(eq(schema.stationPlace.id, id));
  return { ok: true };
}

/**
 * Tar bort en ort. Personal och fordon som pekar på den blir kvar utan
 * ort i stället för att följa med — det är folk och bilar, inte en
 * egenskap hos orten.
 */
export async function removeStation(id: string): Promise<BaseDataResult> {
  const db = getDb();
  await db
    .update(schema.employee)
    .set({ stationPlaceId: null })
    .where(eq(schema.employee.stationPlaceId, id));
  await db
    .update(schema.vehicle)
    .set({ stationPlaceId: null })
    .where(eq(schema.vehicle.stationPlaceId, id));
  await db.delete(schema.stationPlace).where(eq(schema.stationPlace.id, id));
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Personal
 * ------------------------------------------------------------------ */

export async function addEmployee(input: {
  firstName: string;
  lastName: string;
  employeeNumber?: string;
  stationPlaceId?: string | null;
}): Promise<BaseDataResult> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) return { ok: false, error: "Både förnamn och efternamn behövs." };

  const employeeNumber = input.employeeNumber?.trim() || null;
  if (employeeNumber) {
    /* Bara bland dem som lagts in för hand.
     *
     * Anställningsnummer är unika inom ett bolag, inte mellan bolag —
     * två bolag har med stor sannolikhet varsin 2262. Att jämföra mot
     * hela registret skulle därför neka ett nummer som är helt korrekt
     * för den som lägger in det. De som kommit från TransPA skyddas av
     * employee_number_uq, som räknar bolaget med. */
    const taken = await getDb()
      .select({ id: schema.employee.id })
      .from(schema.employee)
      .where(
        and(
          eq(schema.employee.employeeNumber, employeeNumber),
          isNull(schema.employee.transpaTenantId),
        ),
      );
    if (taken.length > 0) {
      return { ok: false, error: `Anställningsnummer ${employeeNumber} används redan.` };
    }
  }

  await getDb().insert(schema.employee).values({
    firstName,
    lastName,
    employeeNumber,
    stationPlaceId: input.stationPlaceId || null,
  });
  return { ok: true };
}

export async function updateEmployee(
  id: string,
  patch: { firstName?: string; lastName?: string; stationPlaceId?: string | null; isActive?: boolean },
): Promise<BaseDataResult> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.firstName !== undefined) {
    if (!patch.firstName.trim()) return { ok: false, error: "Förnamnet får inte vara tomt." };
    set.firstName = patch.firstName.trim();
  }
  if (patch.lastName !== undefined) {
    if (!patch.lastName.trim()) return { ok: false, error: "Efternamnet får inte vara tomt." };
    set.lastName = patch.lastName.trim();
  }
  if (patch.stationPlaceId !== undefined) set.stationPlaceId = patch.stationPlaceId || null;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  await getDb().update(schema.employee).set(set).where(eq(schema.employee.id, id));
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Fordon
 * ------------------------------------------------------------------ */

export async function addVehicle(input: {
  displayName: string;
  registrationNumber?: string;
  stationPlaceId?: string | null;
}): Promise<BaseDataResult> {
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "Bilen behöver ett namn." };

  await getDb().insert(schema.vehicle).values({
    displayName,
    registrationNumber: input.registrationNumber?.trim() || null,
    stationPlaceId: input.stationPlaceId || null,
  });
  return { ok: true };
}

export async function updateVehicle(
  id: string,
  patch: { displayName?: string; registrationNumber?: string | null; stationPlaceId?: string | null; isActive?: boolean },
): Promise<BaseDataResult> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) {
    if (!patch.displayName.trim()) return { ok: false, error: "Namnet får inte vara tomt." };
    set.displayName = patch.displayName.trim();
  }
  if (patch.registrationNumber !== undefined) {
    set.registrationNumber = patch.registrationNumber?.trim() || null;
  }
  if (patch.stationPlaceId !== undefined) set.stationPlaceId = patch.stationPlaceId || null;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  await getDb().update(schema.vehicle).set(set).where(eq(schema.vehicle.id, id));
  return { ok: true };
}
