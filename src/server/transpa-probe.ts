import "server-only";
import { TranspaApiError, TranspaClient, API_BASE } from "@/lib/transpa/client";
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
  ["/v1/trips", "Turer"],
  ["/v1/shifts", "Pass"],
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
const SAMPLE_SHAPE_OF = new Set(["/v1/shifts", "/v1/trips", "/v1/employees"]);

/**
 * Gissningar. `transpaapi:workgroups:read` är beviljat men vägen är
 * okänd — Vismas mönster för de andra resurserna (stationPlaces,
 * workTasks) är camelCase av scope-namnet, därav /v1/workGroups som
 * första gissning. `vehicleGroups` och `trafficAreas` kom från den
 * föråldrade klienten men har inget motsvarande scope bland de
 * beviljade, så de är nedgraderade till gissningar här — de kan ändå
 * svara om de ligger bakom grundscopet.
 */
const GUESSES: Array<[string, string]> = [
  ["/v1/workGroups", "Arbetsgrupper"],
  ["/v1/vehicleGroups", "Fordonsgrupper"],
  ["/v1/trafficAreas", "Trafikområden"],
  ["/v1/schedules", "Scheman"],
  ["/v1/absences", "Frånvaro"],
  ["/v1/timeReports", "Tidrapporter"],
  ["/v1/workSchedules", "Arbetsscheman"],
];

/** Troliga platser för OpenAPI-specen. */
const SPEC_URLS = [
  "https://api.mytranspa.com/doc/openapi/openapi.json",
  "https://api.mytranspa.com/doc/openapi/swagger.json",
  "https://api.mytranspa.com/doc/openapi/v1/openapi.json",
  "https://api.mytranspa.com/publicApi/swagger/v1/swagger.json",
];

function describe(error: unknown): { outcome: ProbeOutcome; status?: number; detail: string } {
  if (error instanceof TranspaApiError) {
    const outcome: ProbeOutcome =
      error.status === 404 ? "missing" : error.status === 403 || error.status === 401 ? "forbidden" : "error";
    return { outcome, status: error.status, detail: error.message };
  }
  if (error instanceof TranspaAuthError) {
    return { outcome: "error", status: error.status, detail: error.message };
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
      endpoints: [...KNOWN, ...GUESSES].map(([path, label]) => ({
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
        endpoints: [...KNOWN, ...GUESSES].map(([path, label]) => ({
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

  for (const [path, label] of [...KNOWN, ...GUESSES]) {
    const known = KNOWN.some(([p]) => p === path);
    try {
      const response = await client.request<{ data?: unknown[] }>(path, {
        limit: path === "/v1/alive" ? undefined : 1,
        scopes,
      });
      const rows = Array.isArray(response?.data) ? response.data.length : undefined;
      const first = response?.data?.[0];
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
      });
    } catch (error) {
      endpoints.push({ path, label, known, ...describe(error) });
    }
  }

  return {
    hasCredentials: true,
    tenantId: credentials.tenantId,
    token: { outcome: tokenOutcome, detail: tokenDetail, scopes },
    spec,
    endpoints,
    ranAt,
  };
}

export { API_BASE };
