import "server-only";
import { eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { TranspaClient } from "@/lib/transpa/client";
import { credentialsForTenant, credentialsFromEnv } from "@/lib/transpa/auth";
import { shiftWindow, shiftToWorkDay, type TranspaShift } from "@/lib/transpa/shifts";
import { withBudget } from "./shift-provider";

/**
 * Slå upp en enskild persons pass i TransPA.
 *
 * Bygget gick i cirklar så länge svaret var "hämtningen fungerar inte".
 * Det här är verktyget som gör frågan konkret i stället: en person, ett
 * datumintervall, och exakt det API:t svarar. Vad ett pass innehåller —
 * särskilt `partsOfDay` och `breaks`, som är nästlade och ännu osedda —
 * går inte att bygga vidare på utan att ha sett det.
 *
 * Hämtar direkt från API:t, inte ur den synkade tabellen: poängen är att
 * se vad TransPA säger, inte vad vi råkar ha sparat.
 */

export interface LookupShift {
  id: string | null;
  /** Datum och skift som verktyget skulle tolka dem, i svensk tid. */
  date: string | null;
  shift: "day" | "night" | null;
  /** Starttiden som TransPA angav den. */
  startDateTime: string | null;
  /** Klockslag i svensk tid, för läsbarhet. */
  localTime: string | null;
  workMinutes: number | null;
  isExtraShift: boolean;
  name: string | null;
  description: string | null;
}

export interface ShiftLookupResult {
  ok: boolean;
  error?: string;
  /** Adressen som anropades, så den går att prova för hand. */
  url?: string;
  who?: { name: string; transpaId: string; employeeNumber: string | null };
  count?: number;
  shifts?: LookupShift[];
  /**
   * Första passet precis som API:t skickade det.
   *
   * De nästlade fälten går inte att beskriva utifrån namnet, och det är
   * dem nästa steg behöver: rasterna avgör om ett pass är delat, och
   * partsOfDay avgör om dag och natt går att läsa säkrare än ur
   * starttimmen.
   */
  raw?: string;
}

/** Klockslaget i svensk tid, för den som läser rapporten. */
function localTime(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Personen, oavsett om man anger namn, anställningsnummer eller
 * TransPA-id. Ett id går också att slå upp direkt, för den som fått ett
 * ur ett annat sammanhang.
 */
async function findPerson(needle: string) {
  const db = getDb();
  const trimmed = needle.trim();
  const [row] = await db
    .select({
      id: schema.employee.id,
      firstName: schema.employee.firstName,
      lastName: schema.employee.lastName,
      employeeNumber: schema.employee.employeeNumber,
      transpaId: schema.employee.transpaId,
      tenantId: schema.employee.transpaTenantId,
    })
    .from(schema.employee)
    .where(
      or(
        eq(schema.employee.transpaId, trimmed),
        eq(schema.employee.id, /^[0-9a-f-]{36}$/i.test(trimmed) ? trimmed : "0".repeat(36)),
        eq(schema.employee.employeeNumber, trimmed),
      ),
    )
    .limit(1);
  return row;
}

export async function lookupShifts(input: {
  /** TransPA-id, vårt id, eller anställningsnummer. */
  person: string;
  from: string;
  to: string;
}): Promise<ShiftLookupResult> {
  const person = input.person.trim();
  if (!person) return { ok: false, error: "Ange en person." };
  if (!input.from || !input.to) return { ok: false, error: "Ange både från- och till-datum." };
  if (input.from > input.to) {
    // API:t avvisar det ändå, med ett fel som inte säger var det gick fel.
    return { ok: false, error: "Från-datumet ligger efter till-datumet." };
  }

  const found = await findPerson(person);

  /* Ett rått TransPA-id ska fungera även för någon som inte är synkad —
     annars går det inte att kontrollera en person innan synken körts. */
  const transpaId = found?.transpaId ?? (/^[0-9a-f-]{36}$/i.test(person) ? person : null);
  if (!transpaId) {
    return {
      ok: false,
      error: `Hittade ingen person på "${person}". Ange TransPA-id, anställningsnummer, eller kör synken först.`,
    };
  }

  const credentials = found?.tenantId
    ? await tenantCredentials(found.tenantId)
    : credentialsFromEnv();
  if (!credentials) {
    return { ok: false, error: "Inga TransPA-uppgifter inlagda för personens bolag." };
  }

  const query = shiftWindow(input.from, input.to);
  const path = `/v1/employees/${transpaId}/shifts/`;
  const url = `${path}?${new URLSearchParams(query)}`;

  try {
    const client = new TranspaClient({ credentials });
    const rows = await withBudget(
      (signal) => client.list<TranspaShift>(path, { query, signal }),
      20_000,
    );

    const shifts: LookupShift[] = rows.map((raw) => {
      const day = raw.startDateTime ? shiftToWorkDay(raw, "—") : null;
      return {
        id: raw.id ?? null,
        date: day?.date ?? null,
        shift: day?.shift ?? null,
        startDateTime: raw.startDateTime ?? null,
        localTime: raw.startDateTime ? localTime(raw.startDateTime) : null,
        workMinutes: raw.adjustedWorkTimeInMinutes ?? null,
        isExtraShift: raw.isExtraShift ?? false,
        name: raw.name ?? null,
        description: raw.description ?? null,
      };
    });

    return {
      ok: true,
      url,
      who: found
        ? {
            name: `${found.firstName} ${found.lastName}`.trim(),
            transpaId,
            employeeNumber: found.employeeNumber,
          }
        : { name: "(ej synkad)", transpaId, employeeNumber: null },
      count: rows.length,
      shifts: shifts.sort((a, b) => (a.startDateTime ?? "").localeCompare(b.startDateTime ?? "")),
      raw: rows[0] ? JSON.stringify(rows[0], null, 2) : undefined,
    };
  } catch (error) {
    return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Klient-id och hemlighet delas; bara tenanten skiljer. */
async function tenantCredentials(tenantRowId: string) {
  const [tenant] = await getDb()
    .select({ tenantId: schema.transpaTenant.tenantId })
    .from(schema.transpaTenant)
    .where(eq(schema.transpaTenant.id, tenantRowId))
    .limit(1);
  return tenant ? credentialsForTenant(tenant.tenantId) : credentialsFromEnv();
}
