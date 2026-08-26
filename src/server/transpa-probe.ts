import "server-only";
import {
  TranspaApiError,
  TranspaClient,
  TranspaShapeError,
  API_BASE,
  rowsOf,
} from "@/lib/transpa/client";
import {
  BASE_SCOPE,
  READ_SCOPES,
  TranspaAuthError,
  credentialsFromEnv,
  getAccessToken,
} from "@/lib/transpa/auth";

/**
 * Undersöker vad er TransPA-tenant faktiskt exponerar.
 *
 * Sidan finns för att den frågan inte går att besvara i förväg: Vismas
 * genererade klient är föråldrad — den saknar /v1/trips, som deras egna
 * exempel anropar — så den duger inte som facit. Det enda som duger är
 * att fråga API:t.
 */

export type ProbeOutcome = "ok" | "empty" | "forbidden" | "missing" | "error" | "not-run";

export interface EndpointProbe {
  path: string;
  label: string;
  /** Känd ur Vismas dokumentation, eller en gissning vi vill få svar på. */
  known: boolean;
  outcome: ProbeOutcome;
  status?: number;
  detail?: string;
  sample?: number;
  /**
   * Fältnamnen i första raden, inte värdena. Poängen är att se formen
   * på svaret utan ett till kodsteg när uppgifterna väl finns — och
   * utan att en diagnostiksida råkar visa personnummer eller adress i
   * klartext för den som tittar.
   */
  sampleKeys?: string[];
  /**
   * Vilken toppnyckel raderna låg under — `items` enligt Vismas modell.
   * Redovisas i stället för att antas, eftersom det var just det
   * antagandet som gjorde varje lista tyst tom.
   */
  rowKey?: string;
}

export interface SpecProbe {
  url: string;
  outcome: ProbeOutcome;
  status?: number;
  paths?: string[];
  version?: string;
}

export interface TenantReport {
  hasCredentials: boolean;
  /** Fältnamnen på en person, och id:t vi kunde plocka ur dem. */
  employeeSample?: { keys: string[]; id: string | null };
  tenantId?: string;
  token: { outcome: ProbeOutcome; detail?: string; scopes: string[] };
  spec?: SpecProbe;
  endpoints: EndpointProbe[];
  ranAt: string;
}

/**
 * Endpoints Visma dokumenterat eller som scope-katalogen i Visma
 * Developer Portal bekräftar existerar (2026-08-24).
 *
 * /v1/shifts hör hemma här av det starkaste skälet som finns: scopet
 * `transpaapi:shifts:read` står bland de beviljade för Börjes app.
 * TransPA har alltså en riktig schema-resurs, inte bara turer — det var
 * den öppna frågan hela den här sidan fanns för att besvara.
 */
const KNOWN: Array<[string, string]> = [
  ["/v1/alive", "Livskontroll"],
  ["/v1/employees", "Personal"],
  ["/v1/vehicles", "Fordon"],
  ["/v1/stationPlaces", "Stationsorter"],
  ["/v1/workTasks", "Arbetsuppgifter"],
  ["/v1/workGroups", "Arbetsgrupper"],
  ["/v1/trips", "Turer"],
];

/**
 * Endpoints där fältnamnen är värda att se, inte bara att anropet
 * lyckas. /v1/shifts är nu den viktigaste — scopet är beviljat, men
 * ingen dokumentation vi når visar vad ett pass faktiskt innehåller.
 * /v1/trips likaså: Vismas egna Postman-exempel anropar den med
 * employeeId, status, startDateTime och endDateTime, men inget om
 * svarsformen. /v1/employees avgör om stationPlaceId finns där eller
 * måste sättas i appen; den kända (föråldrade) modellen saknar den.
 */
/**
 * Vägar där fältnamnen visas.
 *
 * stationPlaces kom till efter att Vismas modell visat sig sakna
 * stationPlaceId på Employee: saknas kopplingen på personen måste den
 * sättas här, och då behöver vi se vad stationsorten själv bär.
 * vehicles finns med trots att fordon skrivs in för hand — formen
 * avgör om vi kan hämta dem senare utan att gissa.
 */
const SAMPLE_SHAPE_OF = new Set([
  "/v1/trips",
  "/v1/employees",
  "/v1/workTasks",
  "/v1/workGroups",
  "/v1/stationPlaces",
  "/v1/vehicles",
]);

/**
 * Gissningar. `transpaapi:workgroups:read` är beviljat men vägen är
 * okänd — Vismas mönster för de andra resurserna (stationPlaces,
 * workTasks) är camelCase av scope-namnet, därav /v1/workGroups som
 * första gissning. `vehicleGroups` och `trafficAreas` kom från den
 * föråldrade klienten men har inget motsvarande scope bland de
 * beviljade, så de är nedgraderade till gissningar här — de kan ändå
 * svara om de ligger bakom grundscopet.
 */
/**
 * Jakten på passen.
 *
 * `transpaapi:shifts:read` är beviljat, så resursen finns — men
 * /v1/shifts svarar 404. Vägen heter alltså något annat. Mönstret hos
 * de endpoints som fungerar är scopet i camelCase (`workgroups` →
 * /v1/workGroups), vilket borde gett /v1/shifts; att det inte gör det
 * pekar mot att passen ligger under en annan resurs, troligast under
 * personen de gäller.
 *
 * Kandidater med {id} i sig provas mot en riktig person, hämtad ur
 * /v1/employees först — annars går de inte att skilja från en felstavad
 * väg.
 */
const SHIFT_CANDIDATES = [
  "/v1/workShifts",
  "/v1/employeeShifts",
  "/v1/shiftSchedules",
  "/v1/shift",
  "/v1/employees/{id}/shifts",
  "/v1/employees/{id}/workShifts",
  "/v1/employees/{id}/schedule",
];

const GUESSES: Array<[string, string]> = [
  ["/v1/schedules", "Scheman"],
  ["/v1/absences", "Frånvaro"],
  ["/v1/absence", "Frånvaro (singular)"],
  ["/v1/vacations", "Semester"],
  ["/v1/timeReports", "Tidrapporter"],
  ["/v1/workSchedules", "Arbetsscheman"],
];

/** Troliga platser för OpenAPI-specen. */
/**
 * Specen är den enda vägen bort från gissningar.
 *
 * Hittas den vet vi exakt vilka vägar som finns, och jakten på passen
 * är över på en gång. Swagger-UI:t ligger på
 * api.mytranspa.com/doc/openapi/swaggerui/, och själva dokumentet
 * brukar ligga i närheten under något av namnen nedan.
 */
const SPEC_URLS = [
  "https://api.mytranspa.com/doc/openapi/openapi.json",
  "https://api.mytranspa.com/doc/openapi/swagger.json",
  "https://api.mytranspa.com/doc/openapi/v1/swagger.json",
  "https://api.mytranspa.com/doc/openapi/v1/openapi.json",
  "https://api.mytranspa.com/doc/openapi/swaggerui/swagger.json",
  "https://api.mytranspa.com/doc/openapi/spec.json",
  "https://api.mytranspa.com/doc/openapi/openapi.yaml",
  "https://api.mytranspa.com/publicApi/swagger/v1/swagger.json",
  "https://api.mytranspa.com/publicApi/openapi.json",
  "https://api.mytranspa.com/swagger/v1/swagger.json",
];

/**
 * Alla vägar sidan redovisar, i den ordning de visas.
 *
 * Finns som en funktion för att listan ska bli densamma oavsett hur
 * långt körningen kom. Tidigare byggdes den på två ställen, och när
 * token-hämtningen misslyckades försvann pass-kandidaterna tyst ur
 * tabellen — vilket såg ut som att de aldrig funnits.
 */
function allPaths(employeeId: string | null): Array<[string, string]> {
  const shifts: Array<[string, string]> = SHIFT_CANDIDATES.map((c) => [
    employeeId ? c.replace("{id}", employeeId) : c,
    c.includes("{id}") ? "Pass under en person" : "Pass",
  ]);
  return [...KNOWN, ...shifts, ...GUESSES];
}

function describe(error: unknown): { outcome: ProbeOutcome; status?: number; detail: string } {
  if (error instanceof TranspaApiError) {
    const outcome: ProbeOutcome =
      error.status === 404 ? "missing" : error.status === 403 || error.status === 401 ? "forbidden" : "error";
    return { outcome, status: error.status, detail: error.message };
  }
  if (error instanceof TranspaAuthError) {
    return { outcome: "error", status: error.status, detail: error.message };
  }
  /* Vägen svarade 200 — det är formen som inte känns igen. Skiljs från
     ett vanligt fel eftersom åtgärden är en annan: här finns resursen,
     men raderna ligger under en nyckel vi inte läser. */
  if (error instanceof TranspaShapeError) {
    return { outcome: "error", status: 200, detail: error.message };
  }
  return { outcome: "error", detail: error instanceof Error ? error.message : String(error) };
}

async function probeSpec(fetchImpl: typeof fetch): Promise<SpecProbe> {
  let last: SpecProbe = { url: SPEC_URLS[0], outcome: "missing" };

  for (const url of SPEC_URLS) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        last = { url, outcome: response.status === 404 ? "missing" : "error", status: response.status };
        continue;
      }
      const spec = (await response.json()) as {
        paths?: Record<string, unknown>;
        info?: { version?: string };
      };
      return {
        url,
        outcome: "ok",
        status: response.status,
        version: spec.info?.version,
        paths: Object.keys(spec.paths ?? {}).sort(),
      };
    } catch (error) {
      const d = describe(error);
      last = { url, outcome: d.outcome, status: d.status };
    }
  }
  return last;
}

export async function probeTenant(fetchImpl: typeof fetch = fetch): Promise<TenantReport> {
  const ranAt = new Date().toISOString();
  const credentials = credentialsFromEnv();
  const spec = await probeSpec(fetchImpl);

  if (!credentials) {
    return {
      hasCredentials: false,
      token: { outcome: "not-run", scopes: READ_SCOPES },
      spec,
      endpoints: allPaths(null).map(([path, label]) => ({
        path,
        label,
        known: KNOWN.some(([p]) => p === path),
        outcome: "not-run" as const,
      })),
      ranAt,
    };
  }

  /* Först grundscopet ensamt: går det igenom vet vi att credentials och
     tenant stämmer, även om de bredare scopen inte är beviljade. */
  let tokenOutcome: ProbeOutcome = "ok";
  let tokenDetail: string | undefined;
  let scopes = READ_SCOPES;
  try {
    await getAccessToken(credentials, READ_SCOPES, fetchImpl);
  } catch (error) {
    try {
      await getAccessToken(credentials, [BASE_SCOPE], fetchImpl);
      scopes = [BASE_SCOPE];
      tokenOutcome = "forbidden";
      tokenDetail =
        "Grundscopet fungerar, men något av läs-scopen är inte beviljat. Begär dem i Visma Developer Portal.";
    } catch (inner) {
      const d = describe(inner);
      return {
        hasCredentials: true,
        tenantId: credentials.tenantId,
        token: { outcome: d.outcome, detail: d.detail, scopes: READ_SCOPES },
        spec,
        endpoints: allPaths(null).map(([path, label]) => ({
          path,
          label,
          known: KNOWN.some(([p]) => p === path),
          outcome: "not-run" as const,
        })),
        ranAt,
      };
    }
  }

  const client = new TranspaClient({ credentials, fetchImpl });
  const endpoints: EndpointProbe[] = [];

  /* En riktig person, för de kandidater som är underresurser. Utan ett
     id skulle /v1/employees/{id}/shifts svara 404 oavsett om vägen
     finns, och svaret vore värdelöst. */
  let sampleEmployeeId: string | null = null;
  let sampleEmployeeKeys: string[] = [];
  try {
    const r = await client.request<unknown>("/v1/employees", { limit: 1, scopes });
    const first = rowsOf<Record<string, unknown>>(r, "/v1/employees").rows[0];
    if (first && typeof first === "object") {
      sampleEmployeeKeys = Object.keys(first);
      /* Fältnamnet gissas inte. Vismas genererade klient är PascalCase
         (Id, FirstName), medan deras Postman-exempel filtrerar på
         camelCase (employeeId) — vilket av dem JSON:en faktiskt
         använder syns först här. Därför letas nyckeln upp utan hänsyn
         till skiftläge i stället för att antas. */
      const key = sampleEmployeeKeys.find((k) => k.toLowerCase() === "id");
      const value = key ? first[key] : undefined;
      if (typeof value === "string" || typeof value === "number") {
        sampleEmployeeId = String(value);
      }
    }
  } catch {
    /* Går det inte syns det ändå på raden för /v1/employees nedan. */
  }

  for (const [path, label] of allPaths(sampleEmployeeId)) {
    const known = KNOWN.some(([p]) => p === path);

    /* Kvar-stående {id} betyder att ingen person gick att plocka ut.
       Raden visas ändå — men att anropa vägen med platshållaren kvar
       vore ett bortkastat anrop vars 404 inte betyder något. */
    if (path.includes("{id}")) {
      endpoints.push({
        path,
        label,
        known,
        outcome: "not-run",
        detail: "Ej provad — inget person-id gick att plocka ur /v1/employees.",
      });
      continue;
    }

    try {
      const response = await client.request<unknown>(path, {
        limit: path === "/v1/alive" ? undefined : 1,
        scopes,
      });
      /* /v1/alive svarar inte med en lista, så där finns inget kuvert
         att packa upp — och en form som inte känns igen ska synas som
         sin egen utgång, inte som ett tomt svar. */
      let rows: number | undefined;
      let first: unknown;
      let rowKey: string | undefined;
      if (path !== "/v1/alive") {
        const unpacked = rowsOf<unknown>(response, path);
        rows = unpacked.rows.length;
        first = unpacked.rows[0];
        rowKey = unpacked.key;
      }
      // Tomt svar ger [] snarare än undefined, för att skilja "frågade
      // men inget kom" från "frågade inte" — annars visar sidan varken
      // fältnamn eller meddelandet om att svaret var tomt.
      const sampleKeys = !SAMPLE_SHAPE_OF.has(path)
        ? undefined
        : first && typeof first === "object"
          ? Object.keys(first as object).sort()
          : [];
      endpoints.push({
        path,
        label,
        known,
        outcome: rows === 0 ? "empty" : "ok",
        status: 200,
        sample: rows,
        sampleKeys,
        rowKey,
      });
    } catch (error) {
      endpoints.push({ path, label, known, ...describe(error) });
    }
  }

  return {
    hasCredentials: true,
    tenantId: credentials.tenantId,
    employeeSample: { keys: sampleEmployeeKeys, id: sampleEmployeeId },
    token: { outcome: tokenOutcome, detail: tokenDetail, scopes },
    spec,
    endpoints,
    ranAt,
  };
}

export { API_BASE };
