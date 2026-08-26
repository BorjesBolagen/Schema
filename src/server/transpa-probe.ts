import "server-only";
import { overlapsRange } from "@/lib/transpa/filter";
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

/**
 * Är turerna planerade eller körda?
 *
 * Det avgör om arbetsdagarna kan hämtas från TransPA alls. Finns turer som
 * ligger i framtiden vet TransPA vem som ska jobba, och arbetsdagarna
 * kan hämtas i stället för att gissas ur ett mönster. Finns bara turer
 * bakåt är /v1/trips historik, och då kan den på sin höjd föreslå ett
 * mönster.
 *
 * Bara antal och statusvärden redovisas — aldrig employeeId eller
 * tider, som pekar ut enskilda personers arbetspass.
 */
export interface TripWindow {
  rows: number;
  /** Sant när taket nåddes — då är rows ett minimum, inte ett antal. */
  capped: boolean;
  statuses: string[];
}

export interface TripsWindow {
  outcome: ProbeOutcome;
  detail?: string;
  future?: TripWindow;
  past?: TripWindow;
  /** Slutsatsen, uttryckt så att den går att handla på. */
  verdict?: "planerade" | "bara-korda" | "inga-turer";
}

/**
 * Vad bär `grouping` och `professionGroup` egentligen?
 *
 * Synken hämtade 301 personer, och ingen av dem har stationsort —
 * TransPA:s Employee bär ingen. Att sätta orten för hand på 301
 * personer är dagsverke, så frågan är om något av de två okända
 * gruppfälten redan är orten. Stämmer värdena mot de 17 stationsorter
 * vi hämtat kan kopplingen göras automatiskt i stället.
 *
 * Bara distinkta värden och antal redovisas — aldrig vem som har
 * vilket. En gruppbeteckning är inte en personuppgift; kopplingen
 * mellan person och grupp vore ett steg närmare att vara det, och
 * behövs inte för att svara på frågan.
 */
export interface GroupFieldProbe {
  field: string;
  /** Distinkta värden, högst så många som TOP_VALUES anger. */
  values: Array<{ value: string; count: number }>;
  distinct: number;
  /** Hur många av värdena som matchar en känd stationsort. */
  matchesStation: number;
  /** Personer utan värde i fältet. */
  blank: number;
}

export interface GroupingProbe {
  outcome: ProbeOutcome;
  detail?: string;
  /** Antal personer frågan bygger på. */
  sampled: number;
  stationNames: string[];
  fields: GroupFieldProbe[];
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
  trips?: TripsWindow;
  grouping?: GroupingProbe;
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
 * Jakten på passen — avslutad, utan träff.
 *
 * `transpaapi:shifts:read` är beviljat, men samtliga kandidater nedan
 * svarar 404, även med ett riktigt person-id insatt (körning
 * 2026-08-26). Detsamma gäller frånvaro, semester och scheman. Ett
 * beviljat scope betyder alltså bara att katalogen känner till namnet,
 * inte att Public API exponerar resursen.
 *
 * Slutsatsen: TransPA:s Public API levererar inga planerade pass. De
 * lokala arbetsmönstren är därmed inte en parentes utan grunden, och
 * /v1/trips är det enda som säger något om när en person faktiskt är i
 * tjänst.
 *
 * Listan står kvar som bevakning: svarar någon av dem annat än 404 en
 * dag har Visma öppnat resursen, och då är det värt att veta.
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

/**
 * Frågar /v1/trips i två fönster: en vecka framåt och en vecka bakåt.
 *
 * Ett svar med rader framåt betyder att TransPA bär planerade turer.
 * Filtret är på startDateTime eftersom det är fältet Vismas egna
 * exempel filtrerar på.
 */
async function probeTrips(client: TranspaClient, scopes: string[]): Promise<TripsWindow> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const DAY = 86_400_000;

  /* Taket finns för att fönsterfrågan ska vara billig — den ska svara
     på om det finns turer, inte räkna dem. */
  const LIMIT = 50;

  const window = async (from: string, to: string): Promise<TripWindow> => {
    const response = await client.request<unknown>("/v1/trips", {
      filter: overlapsRange("startDateTime", from, to),
      limit: LIMIT,
      scopes,
    });
    const rows = rowsOf<Record<string, unknown>>(response, "/v1/trips").rows;
    /* Status är ett tillståndsvärde, inte en personuppgift — till
       skillnad från employeeId och tiderna, som aldrig lämnar servern. */
    const statuses = [
      ...new Set(rows.map((r) => (typeof r.status === "string" ? r.status : "")).filter(Boolean)),
    ].sort();
    return { rows: rows.length, capped: rows.length >= LIMIT, statuses };
  };

  try {
    const future = await window(iso(now), iso(now + 7 * DAY));
    const past = await window(iso(now - 7 * DAY), iso(now));
    const verdict = future.rows > 0 ? "planerade" : past.rows > 0 ? "bara-korda" : "inga-turer";
    return { outcome: "ok", future, past, verdict };
  } catch (error) {
    return { ...describe(error), future: undefined, past: undefined };
  }
}

/** Så många distinkta värden som visas per fält. Fler säger inget mer. */
const TOP_VALUES = 20;
/** Så många personer frågan bygger på. Räcker gott för att se ett mönster. */
const GROUPING_SAMPLE = 300;

/** Fälten som skulle kunna bära orten. Namnen kom ur en riktig körning. */
const GROUP_FIELDS = ["grouping", "professionGroup"];

/** Jämför utan hänsyn till skiftläge och kringmellanslag — "Nybro " är Nybro. */
const norm = (v: string) => v.trim().toLowerCase();

/**
 * Ett gruppfälts värde som text, oavsett om TransPA skickar en sträng
 * eller ett objekt med namn i.
 */
function groupValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["name", "Name", "description", "value"]) {
      if (typeof o[key] === "string" && o[key].trim()) return (o[key] as string).trim();
    }
  }
  return null;
}

async function probeGrouping(client: TranspaClient, scopes: string[]): Promise<GroupingProbe> {
  try {
    const stationsRaw = await client.request<unknown>("/v1/stationPlaces", { limit: 200, scopes });
    const stations = rowsOf<Record<string, unknown>>(stationsRaw, "/v1/stationPlaces").rows;
    const stationNames = stations
      .map((s) => (typeof s.name === "string" ? s.name : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "sv"));
    const known = new Set(stationNames.map(norm));

    const peopleRaw = await client.request<unknown>("/v1/employees", {
      limit: GROUPING_SAMPLE,
      scopes,
    });
    const people = rowsOf<Record<string, unknown>>(peopleRaw, "/v1/employees").rows;

    const fields: GroupFieldProbe[] = GROUP_FIELDS.map((field) => {
      const counts = new Map<string, number>();
      let blank = 0;

      for (const person of people) {
        const value = groupValue(person[field]);
        if (!value) {
          blank++;
          continue;
        }
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }

      const values = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "sv"));

      return {
        field,
        values: values.slice(0, TOP_VALUES),
        distinct: values.length,
        matchesStation: values.filter((v) => known.has(norm(v.value))).length,
        blank,
      };
    });

    return { outcome: "ok", sampled: people.length, stationNames, fields };
  } catch (error) {
    const d = describe(error);
    return { ...d, sampled: 0, stationNames: [], fields: [] };
  }
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

  /* Körs efter endpoint-svepet: utan att veta att /v1/trips svarar
     alls vore fönsterfrågan bara brus. */
  const trips = endpoints.some((e) => e.path === "/v1/trips" && e.outcome !== "missing")
    ? await probeTrips(client, scopes)
    : undefined;

  const grouping = endpoints.some((e) => e.path === "/v1/employees" && e.outcome === "ok")
    ? await probeGrouping(client, scopes)
    : undefined;

  return {
    hasCredentials: true,
    trips,
    grouping,
    tenantId: credentials.tenantId,
    employeeSample: { keys: sampleEmployeeKeys, id: sampleEmployeeId },
    token: { outcome: tokenOutcome, detail: tokenDetail, scopes },
    spec,
    endpoints,
    ranAt,
  };
}

export { API_BASE };
