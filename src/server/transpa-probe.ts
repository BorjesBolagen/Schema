import "server-only";
import { overlapsRange } from "@/lib/transpa/filter";
import {
  describeSpecPaths,
  parseOpenApiYaml,
} from "@/lib/transpa/openapi-yaml";
import type { SpecWrite } from "@/lib/transpa/write-paths";
import {
  TranspaApiError,
  TranspaClient,
  TranspaShapeError,
  API_BASE,
  MAX_LIMIT,
  rowsOf,
  type Problem,
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

export type ProbeOutcome =
  | "ok"
  | "empty"
  | "forbidden"
  | "missing"
  | "error"
  | "not-run";

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
  /**
   * Scopet vägen kräver, när svaret var 403 och namngav det.
   *
   * En nekad väg är en träff, inte ett misslyckande: den bevisar att
   * resursen finns och säger exakt vad som ska begäras i Visma
   * Developer Portal.
   */
  requiredScope?: string;
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
  /** Sant när sidtaket nåddes — då är rows ett minimum, inte ett antal. */
  capped: boolean;
  /**
   * Hur många olika personer turerna fördelar sig på.
   *
   * Det är den avgörande siffran. Är en tur ett arbetspass ska nästan
   * varje chaufför ha flera turer i veckan. Fördelar sig i stället en
   * handfull turer på lika många personer är "tur" något annat —
   * fälten allowanceReductions och borderCrossings pekar mot en
   * traktamentsgrundande resa.
   *
   * Bara antalet, aldrig vilka.
   */
  employees: number;
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

/**
 * En väg som specen listar men som ändå svarar 404.
 *
 * /v1/shifts/ står i specen, scopet transpaapi:shifts:read är beviljat,
 * och ändå kommer 404 — medan /v1/timeReports/shifts, som specen inte
 * har, svarade 403. Det senare matchade sannolikt mönstret
 * /v1/timeReports/{id} med "shifts" som id.
 *
 * I stället för att gissa vidare provas varianterna var för sig: med
 * och utan avslutande snedstreck, med och utan frågeparametrar, och mot
 * den bas specen själv anger. Först då går det att säga vad som
 * saknas — rutten, parametrarna eller basen.
 */
export interface PathVariant {
  url: string;
  what: string;
  outcome: ProbeOutcome;
  status?: number;
  detail?: string;
  rows?: number;
  sampleKeys?: string[];
}

export type { SpecWrite };

export interface SpecProbe {
  url: string;
  outcome: ProbeOutcome;
  status?: number;
  paths?: string[];
  version?: string;
  /**
   * Bas-URL:en specen själv anger.
   *
   * Avgörande när en väg som står i specen ändå svarar 404: står
   * servern någon annanstans än den vi anropar är det förklaringen.
   */
  servers?: string[];
  /**
   * Vägarna som inte bara går att läsa.
   *
   * Hela frågan för fas 3 och 4: går det att skriva tillbaka en
   * schemaändring och en frånvaro till TransPA? Svaret står i specen,
   * men läsningen kastade bort allt utom GET innan det nådde skärmen —
   * så det gick inte att se.
   */
  writes?: SpecWrite[];
  /**
   * Obligatoriska frågeparametrar per väg, för GET.
   *
   * Det är den saknade biten: en väg som står i specen men svarar 404
   * kan helt enkelt kräva parametrar anropet inte skickar.
   */
  requiredQuery?: Record<string, string[]>;
  /**
   * Alla namngivna frågeparametrar per väg, inte bara de krävda.
   *
   * Sonden ska inte hänga på att min YAML-tolk får `required` rätt —
   * den missen kostade en hel körning där varianten med parametrar
   * aldrig ens genererades. Finns en parameter namngiven provas den.
   */
  queryParams?: Record<string, string[]>;
  /**
   * Hur många parametrar tolken hittade i hela specen.
   *
   * Noll krävda parametrar kan betyda två helt olika saker: att specen
   * inte har några, eller att tolken inte ser dem. Antalet skiljer dem
   * åt.
   */
  parameterCount?: number;
  /** Parametrarna på passvägen, krävda som valfria. */
  shiftParameters?: Array<{
    name: string;
    location?: string;
    required: boolean;
  }>;
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
  /** Varianter av passvägen, när den listas i specen men svarar 404. */
  shiftVariants?: PathVariant[];
  endpoints: EndpointProbe[];
  ranAt: string;
}

/**
 * Endpoints Visma dokumenterat eller som scope-katalogen i Visma
 * Developer Portal bekräftar existerar (2026-08-24).
 *
 * Listan kommer numera ur den hämtade specen (0.1.138) i stället för ur
 * gissningar. Att en väg står i specen är dock inte samma sak som att
 * den svarar för den här tenanten — flera gör det inte, och den
 * skillnaden är det sidan finns för att mäta.
 */
const KNOWN: Array<[string, string]> = [
  ["/v1/alive", "Livskontroll"],
  ["/v1/employees", "Personal"],
  ["/v1/vehicles", "Fordon"],
  ["/v1/stationPlaces", "Stationsorter"],
  ["/v1/workTasks", "Arbetsuppgifter"],
  ["/v1/workGroups", "Arbetsgrupper"],
  ["/v1/trafficAreas", "Trafikområden"],
  ["/v1/vehicleGroups", "Fordonsgrupper"],
  ["/v1/trips", "Turer"],

  /* Ur specen (0.1.138), inte ur gissningar. Att de står där betyder
     inte att de svarar: /v1/shifts/ ger 404 trots att specen listar den
     och transpaapi:shifts:read är beviljat. Därför provas varianterna
     separat längre ned — det är den motsägelsen som ska förklaras, inte
     bortförklaras. */
  ["/v1/shifts/", "Pass"],
  ["/v1/timeReports", "Tidrapporter"],
  ["/v1/timereportConfiguration/", "Tidrapportinställningar"],
  ["/v1/tachographDataAbstractions", "Färdskrivardata"],
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
  "/v1/shifts/",
  "/v1/timeReports",
  "/v1/employees/{id}/shifts/",
  "/v1/employee/{id}/employeeContracts",
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
/**
 * Underresurser under en person, ur specen.
 *
 * Provas mot ett riktigt person-id, hämtat ur /v1/employees först —
 * annars går de inte att skilja från en felstavad väg.
 */
const SHIFT_CANDIDATES = [
  "/v1/employees/{id}/shifts/",
  "/v1/employees/{id}/timereports/",
  "/v1/employee/{id}/employeeContracts",
];

/**
 * Frånvaro och semester.
 *
 * Specen (0.1.138, 47 vägar) har ingen av dem — varken frånvaro,
 * semester eller arbetsscheman. Listan står kvar som bevakning: svarar
 * någon av dem en dag har Visma öppnat resursen, och då är det värt att
 * veta. Fram till dess ägs frånvaro och semester här.
 */
const GUESSES: Array<[string, string]> = [
  ["/v1/absences", "Frånvaro"],
  ["/v1/vacations", "Semester"],
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
/**
 * Swagger-UI:t, som vet var specen ligger.
 *
 * Att gissa spec-URL:en var fel metod: tio gissningar gav tio 404 och
 * slutsatsen "specen finns inte" — vilket var fel. Den ligger bakom
 * gränssnittet, och sidan bär adressen till sin egen spec, antingen
 * inline eller i swagger-initializer.js. Den läses ur i stället.
 */
const SWAGGER_UI_URLS = [
  "https://api.mytranspa.com/doc/openapi/swaggerui/",
  "https://api.mytranspa.com/doc/openapi/swaggerui/index.html",
];

/** Sista utväg om UI:t inte går att läsa. */
const SPEC_FALLBACKS = [
  "https://api.mytranspa.com/doc/openapi/openapi.json",
  "https://api.mytranspa.com/doc/openapi/swagger.json",
  "https://api.mytranspa.com/doc/openapi/v1/openapi.json",
];

/**
 * Plockar ut adresser till spec-filer ur en Swagger-UI-sida.
 *
 * Swagger UI skriver antingen `url: "..."` eller `urls: [{url: "..."}]`,
 * i sidan eller i sin initializer. Relativa adresser löses mot sidan.
 */
export function specUrlsFrom(html: string, base: string): string[] {
  const found = new Set<string>();

  for (const m of html.matchAll(
    /["'](?:config)?[Uu]rl["']\s*:\s*["']([^"']+)["']/g,
  )) {
    found.add(m[1]);
  }
  for (const m of html.matchAll(/["']([^"'\s]+\.(?:json|yaml|yml))["']/g)) {
    found.add(m[1]);
  }

  return (
    [...found]
      .filter((u) => !/\.(js|css|png|svg|ico|map)$/i.test(u))
      // Swagger UI:s inbyggda demo. Den stod kvar i sidan och togs för
      // TransPA:s spec, med fjorton husdjursvägar som följd.
      .filter((u) => !/petstore|swagger\.io/i.test(u))
      .map((u) => {
        try {
          return new URL(u, base).toString();
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
}

/**
 * Alla vägar sidan redovisar, i den ordning de visas.
 *
 * Finns som en funktion för att listan ska bli densamma oavsett hur
 * långt körningen kom. Tidigare byggdes den på två ställen, och när
 * token-hämtningen misslyckades försvann pass-kandidaterna tyst ur
 * tabellen — vilket såg ut som att de aldrig funnits.
 */
function allPaths(
  employeeId: string | null,
  urval: readonly string[] | "alla" = "alla",
): Array<[string, string]> {
  const shifts: Array<[string, string]> = SHIFT_CANDIDATES.map((c) => [
    c,
    "Pass under en person",
  ]);
  const alla: Array<[string, string]> = [...KNOWN, ...shifts, ...GUESSES];

  /* Filtret läggs på mallen och inte på den färdiga adressen: efter att
     {id} bytts mot ett riktigt person-id går vägen inte längre att
     känna igen. */
  return alla
    .filter(([mall]) => urval === "alla" || urval.includes(mall))
    .map(([mall, label]) => [
      employeeId ? mall.replace("{id}", employeeId) : mall,
      label,
    ]);
}

/**
 * Vad en körning ska omfatta.
 *
 * Finns för att kvoten är liten. Hela svepningen är ett trettiotal
 * anrop, och den som vill veta en enda sak — svarar passvägen? — ska
 * inte behöva betala för de tjugonio andra. Utelämnade fält betyder
 * "kör allt", så det som redan anropar probeTenant utan urval får
 * samma sak som förut.
 */
export interface ProbeOptions {
  /** Vägar att prova, som de står i listorna (med {id} kvar). */
  paths?: readonly string[] | "alla";
  /** Läs OpenAPI-specen. Ligger på dokumentvärden, inte på API:t. */
  spec?: boolean;
  /**
   * Hämta en person först, för att kunna sätta in ett riktigt id.
   * Kostar ett anrop, och behövs bara för underresurserna.
   */
  sampleEmployee?: boolean;
  trips?: boolean;
  grouping?: boolean;
  shiftVariants?: boolean;
}

const ALLT: Required<ProbeOptions> = {
  paths: "alla",
  spec: true,
  sampleEmployee: true,
  trips: true,
  grouping: true,
  shiftVariants: true,
};

/**
 * Scopet ur ett nekat svar.
 *
 * TransPA svarar "Claim value mismatch: scope=transpaapi:timereports:read"
 * — alltså med namnet på precis det som saknas. Det är för värdefullt
 * för att bara visas som en felrad.
 */
export function scopeFromDenial(detail: string): string | undefined {
  return /scope=([a-z0-9:_-]+)/i.exec(detail)?.[1];
}

function describe(error: unknown): {
  outcome: ProbeOutcome;
  status?: number;
  detail: string;
  requiredScope?: string;
} {
  if (error instanceof TranspaApiError) {
    const outcome: ProbeOutcome =
      error.status === 404
        ? "missing"
        : error.status === 403 || error.status === 401
          ? "forbidden"
          : "error";
    return {
      outcome,
      status: error.status,
      detail: error.message,
      requiredScope:
        outcome === "forbidden" ? scopeFromDenial(error.message) : undefined,
    };
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
  return {
    outcome: "error",
    detail: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Frågar /v1/trips i två fönster: en vecka framåt och en vecka bakåt.
 *
 * Ett svar med rader framåt betyder att TransPA bär planerade turer.
 * Filtret är på startDateTime eftersom det är fältet Vismas egna
 * exempel filtrerar på.
 */
async function probeTrips(
  client: TranspaClient,
  scopes: string[],
): Promise<TripsWindow> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const DAY = 86_400_000;

  /* Fem sidor à 100 rader räcker för att se hur turerna fördelar sig,
     och sätter ändå ett tak så frågan förblir billig. */
  const TRIP_PAGES = 5;

  const window = async (from: string, to: string): Promise<TripWindow> => {
    /* Bläddring i stället för en enda sida: antalet turer säger inget
       utan att veta hur många personer de fördelar sig på, och en sida
       på 100 rader räcker inte för att se det. */
    const rows = await client.list<Record<string, unknown>>(
      "/v1/trips",
      { filter: overlapsRange("startDateTime", from, to), scopes },
      TRIP_PAGES,
    );

    /* Status är ett tillståndsvärde, inte en personuppgift — till
       skillnad från employeeId och tiderna, som aldrig lämnar servern.
       Personerna räknas, men inga id:n förs vidare. */
    const statuses = [
      ...new Set(
        rows
          .map((r) => (typeof r.status === "string" ? r.status : ""))
          .filter(Boolean),
      ),
    ].sort();
    const employees = new Set(
      rows
        .map((r) => (typeof r.employeeId === "string" ? r.employeeId : ""))
        .filter(Boolean),
    ).size;

    return {
      rows: rows.length,
      capped: rows.length >= TRIP_PAGES * MAX_LIMIT,
      employees,
      statuses,
    };
  };

  try {
    const future = await window(iso(now), iso(now + 7 * DAY));
    const past = await window(iso(now - 7 * DAY), iso(now));
    const verdict =
      future.rows > 0
        ? "planerade"
        : past.rows > 0
          ? "bara-korda"
          : "inga-turer";
    return { outcome: "ok", future, past, verdict };
  } catch (error) {
    return { ...describe(error), future: undefined, past: undefined };
  }
}

/** Så många distinkta värden som visas per fält. Fler säger inget mer. */
const TOP_VALUES = 20;
/**
 * Så många sidor personal frågan bläddrar igenom.
 *
 * En sida är högst 100 rader — TransPA:s tak — så fem sidor räcker för
 * Börjes 301 personer och sätter ändå en gräns för en tenant som skulle
 * vara mycket större.
 */
const GROUPING_PAGES = 5;

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
      if (typeof o[key] === "string" && o[key].trim())
        return (o[key] as string).trim();
    }
  }
  return null;
}

async function probeGrouping(
  client: TranspaClient,
  scopes: string[],
): Promise<GroupingProbe> {
  try {
    /* Bläddring, inte en stor sida: stationPlaces har ingen
       limit-parameter alls, och där den finns är taket 100. */
    const stations = await client.list<Record<string, unknown>>(
      "/v1/stationPlaces",
      { scopes },
    );
    const stationNames = stations
      .map((s) => (typeof s.name === "string" ? s.name : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "sv"));
    const known = new Set(stationNames.map(norm));

    const people = await client.list<Record<string, unknown>>(
      "/v1/employees",
      { scopes },
      GROUPING_PAGES,
    );

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
        .sort(
          (a, b) => b.count - a.count || a.value.localeCompare(b.value, "sv"),
        );

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

/**
 * Är det här TransPA:s spec, eller Swagger UI:s demo?
 *
 * Swagger UI levereras med petstore.swagger.io som standardadress, och
 * den stod kvar i sidan. Upptäckaren tog den, sidan listade fjorton
 * husdjursvägar och drog slutsatsen att TransPA inte har några pass —
 * ur ett helt annat API. En spec som inte kan visa att den är TransPA:s
 * duger inte som facit.
 */
export function looksLikeTranspa(
  url: string,
  spec: {
    servers?: Array<{ url?: string }>;
    host?: string;
    info?: { title?: string };
  },
  paths: string[],
): boolean {
  const haystack = [
    url,
    spec.host ?? "",
    spec.info?.title ?? "",
    ...(spec.servers ?? []).map((s) => s.url ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  if (/petstore|swagger\.io|example\.com/.test(haystack)) return false;
  if (/transpa|mytranspa/.test(haystack)) return true;

  /* Ingen självidentifiering: godta ändå om vägarna ser ut som TransPA:s
     egna — /v1/employees och /v1/stationPlaces är bekräftade. */
  const known = [
    "/v1/employees",
    "/v1/stationplaces",
    "/v1/vehicles",
    "/v1/trips",
  ];
  const lower = paths.map((p) => p.toLowerCase());
  return known.filter((k) => lower.some((p) => p.startsWith(k))).length >= 2;
}

/** Ett hämtat spec-dokument, eller varför det inte gick. */
async function readSpec(
  url: string,
  fetchImpl: typeof fetch,
): Promise<SpecProbe | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
    });
    if (!response.ok) return null;

    const text = await response.text();

    /* TransPA:s spec ligger som YAML. Adressen fanns i Swagger-UI-sidan
       hela tiden, men läsningen försökte tolka den som JSON och gav upp
       — och sidan rapporterade att specen inte gick att hämta. */
    if (!text.trimStart().startsWith("{")) {
      const parsed = parseOpenApiYaml(text);
      if (parsed.paths.length === 0) return null;
      const paths = describeSpecPaths(parsed);
      if (
        !looksLikeTranspa(
          url,
          {
            servers: parsed.servers.map((u) => ({ url: u })),
            info: { title: parsed.title },
          },
          parsed.paths.map((x) => x.path),
        )
      ) {
        return null;
      }
      const requiredQuery: Record<string, string[]> = {};
      const queryParams: Record<string, string[]> = {};
      for (const entry of parsed.paths) {
        const get = entry.operations.find((o) => o.method === "GET");
        const named = (get?.parameters ?? []).filter(
          (x) => x.location === "query",
        );
        const required = named.filter((x) => x.required).map((x) => x.name);
        if (required.length) requiredQuery[entry.path] = required;
        if (named.length) queryParams[entry.path] = named.map((x) => x.name);
      }

      const writes: SpecWrite[] = parsed.paths.flatMap((entry) =>
        entry.operations
          .filter((op) => op.method !== "GET")
          .map((op) => ({
            path: entry.path,
            method: op.method,
            summary: op.summary,
          })),
      );

      return {
        url,
        outcome: "ok",
        status: response.status,
        version: parsed.version,
        paths,
        servers: parsed.servers,
        writes,
        requiredQuery,
        queryParams,
        parameterCount: parsed.paths.reduce(
          (n, entry) =>
            n + entry.operations.reduce((m, op) => m + op.parameters.length, 0),
          0,
        ),
        shiftParameters: parsed.paths
          .find(
            (entry) =>
              entry.path === "/v1/shifts/" || entry.path === "/v1/shifts",
          )
          ?.operations.find((op) => op.method === "GET")?.parameters,
      };
    }

    const spec = JSON.parse(text) as {
      paths?: Record<string, Record<string, unknown>>;
      info?: { version?: string; title?: string };
      servers?: Array<{ url?: string }>;
      host?: string;
    };
    if (!spec.paths || Object.keys(spec.paths).length === 0) return null;
    if (!looksLikeTranspa(url, spec, Object.keys(spec.paths))) return null;

    /* Vägarna med metod, så det syns om en resurs bara går att läsa en
       i taget — get-shift kan vara /v1/shifts/{id} utan listväg. */
    const paths = Object.entries(spec.paths)
      .map(([path, ops]) => {
        const methods = Object.keys(ops ?? {})
          .filter((m) =>
            ["get", "post", "put", "patch", "delete"].includes(m.toLowerCase()),
          )
          .map((m) => m.toUpperCase())
          .sort();
        return methods.length ? `${path}  [${methods.join(" ")}]` : path;
      })
      .sort();

    const writes: SpecWrite[] = Object.entries(spec.paths).flatMap(
      ([path, ops]) =>
        Object.keys(ops ?? {})
          .filter((m) =>
            ["post", "put", "patch", "delete"].includes(m.toLowerCase()),
          )
          .map((m) => ({ path, method: m.toUpperCase() })),
    );

    return {
      url,
      outcome: "ok",
      status: response.status,
      version: spec.info?.version,
      paths,
      writes,
      servers: (spec.servers ?? []).map((x) => x.url ?? "").filter(Boolean),
    };
  } catch {
    return null;
  }
}

/**
 * Letar rätt på OpenAPI-specen.
 *
 * Först genom att läsa Swagger-UI-sidan och plocka ut adressen den
 * själv använder — inklusive dess initializer, där adressen oftast
 * står. Gissningarna finns kvar men sist: de gav tio 404 och en
 * felaktig slutsats förra gången.
 */
/**
 * Provar passvägen på flera sätt och redovisar varje utfall.
 *
 * Anropen görs med rå fetch i stället för genom klienten, eftersom det
 * är just klientens antaganden — frågeparametrarna och bas-URL:en — som
 * ska kunna uteslutas.
 */
/**
 * Ett rimligt värde för en parameter, utifrån vad den heter.
 *
 * Specen säger vilka parametrar som krävs men inte vad de ska
 * innehålla. Datumnamn får den innevarande veckan, id-namn får personen
 * vi redan hämtat, och resten får ett värde som åtminstone är giltigt.
 */
function guessParamValue(name: string, employeeId: string | null): string {
  const n = name.toLowerCase();
  const now = Date.now();
  const day = 86_400_000;

  /* Ändelsen avgör, inte inledningen. startDateTimeBefore innehåller
     både "start" och "before" — läses "start" först får båda gränserna
     samma datum, och API:t svarar "startDateTimeBefore has to be after
     startDateTimeAfter". Det är precis vad som hände. */
  if (/(after|from|since)$|^(from|after)/.test(n))
    return new Date(now - 7 * day).toISOString();
  if (/(before|until|to)$|^(to|before|until)/.test(n))
    return new Date(now + 7 * day).toISOString();

  if (/(start|begin)/.test(n)) return new Date(now - 7 * day).toISOString();
  if (/(end|stop)/.test(n)) return new Date(now + 7 * day).toISOString();
  if (/date|time/.test(n)) return new Date(now).toISOString();
  if (/employee/.test(n) && employeeId) return employeeId;
  return "1";
}

export { guessParamValue as __guessParamValue };

async function probeShiftVariants(
  token: string,
  spec: SpecProbe,
  employeeId: string | null,
  fetchImpl: typeof fetch,
): Promise<PathVariant[]> {
  /* Specens serveradresser slutar på snedstreck. Utan trimning blev
     anropen publicApi//v1/shifts/ — en dubbel snedstreck som gör alla
     varianter mot den basen värdelösa. */
  const trim = (u: string) => u.replace(/\/+$/, "");
  const bases = [
    ...new Set([API_BASE, ...(spec.servers ?? []).map(trim).filter(Boolean)]),
  ];

  /**
   * Frågesträngen för en vägs parametrar.
   *
   * De krävda om tolken hittat några, annars alla namngivna — hellre
   * ett anrop för mycket än en variant som aldrig genereras för att en
   * flagga lästes fel.
   */
  const queryFor = (path: string): { query: string; names: string[] } => {
    const names = spec.requiredQuery?.[path]?.length
      ? spec.requiredQuery[path]
      : (spec.queryParams?.[path] ?? []);
    if (names.length === 0) return { query: "", names };
    return {
      query: `?${new URLSearchParams(names.map((n) => [n, guessParamValue(n, employeeId)]))}`,
      names,
    };
  };

  const LIST = "/v1/shifts/";
  const PER_PERSON = "/v1/employees/{id}/shifts/";

  const attempts: Array<{ url: string; what: string }> = [];
  for (const base of bases) {
    const where = base === API_BASE ? "" : ` · bas ur specen: ${base}`;
    const list = queryFor(LIST);

    attempts.push(
      { url: `${base}${LIST}`, what: `listan, utan parametrar${where}` },
      { url: `${base}/v1/shifts`, what: `listan, utan snedstreck${where}` },
    );
    if (list.query) {
      attempts.push({
        url: `${base}${LIST}${list.query}`,
        what: `listan, med specens parametrar: ${list.names.join(", ")}${where}`,
      });
    }

    /* Vägen via personen är den Visma pekar ut som den rätta, och den
       kräver samma parameter som listan. Att jag skickade kravet bara
       till listan var hela skälet till att den här svarade 404. */
    if (employeeId) {
      const perPerson = queryFor(PER_PERSON);
      const path = `/v1/employees/${employeeId}/shifts/`;
      attempts.push({
        url: `${base}${path}`,
        what: `under personen, utan parametrar${where}`,
      });
      if (perPerson.query) {
        attempts.push({
          url: `${base}${path}${perPerson.query}`,
          what: `under personen, med specens parametrar: ${perPerson.names.join(", ")}${where}`,
        });
      }
    }
  }

  const out: PathVariant[] = [];
  for (const attempt of attempts) {
    try {
      const response = await fetchImpl(attempt.url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      const text = await response.text();

      if (!response.ok) {
        let detail = `${response.status}`;
        try {
          const problem = JSON.parse(text) as Problem;
          detail = problem.detail ?? problem.title ?? detail;
        } catch {
          /* inte problem+json */
        }
        /* Den råa kroppen med: ett 404 utan problem+json kan ändå bära
           ett routningsfel eller ett modulnamn, och det är precis vad
           som behövs när vägen står i specen men inte svarar. */
        const raw = text.trim().slice(0, 200);
        if (raw && !detail.includes(raw.slice(0, 40)))
          detail += ` · svar: ${raw}`;
        out.push({
          ...attempt,
          outcome:
            response.status === 404
              ? "missing"
              : response.status === 403
                ? "forbidden"
                : "error",
          status: response.status,
          detail,
        });
        continue;
      }

      /* Ett pass bär tider och en person. Fältnamnen är det vi behöver
         för att skriva hämtningen — aldrig värdena. */
      const body: unknown = text ? JSON.parse(text) : null;
      const rows = rowsOf<Record<string, unknown>>(body, attempt.url).rows;
      const first = rows[0];
      out.push({
        ...attempt,
        outcome: rows.length === 0 ? "empty" : "ok",
        status: response.status,
        rows: rows.length,
        sampleKeys:
          first && typeof first === "object" ? Object.keys(first).sort() : [],
      });
    } catch (error) {
      out.push({ ...attempt, ...describe(error) });
    }
  }
  return out;
}

async function probeSpec(fetchImpl: typeof fetch): Promise<SpecProbe> {
  const tried: string[] = [];

  for (const uiUrl of SWAGGER_UI_URLS) {
    let html: string;
    try {
      const response = await fetchImpl(uiUrl, {
        headers: { Accept: "text/html" },
      });
      if (!response.ok) {
        tried.push(`${uiUrl} → ${response.status}`);
        continue;
      }
      html = await response.text();
    } catch (error) {
      tried.push(
        `${uiUrl} → ${error instanceof Error ? error.message : "fel"}`,
      );
      continue;
    }

    /* Initializern räknas som en del av sidan: Swagger UI lägger ofta
       adressen där i stället för i HTML:en. */
    const candidates = specUrlsFrom(html, uiUrl);
    try {
      const init = await fetchImpl(
        new URL("swagger-initializer.js", uiUrl).toString(),
      );
      if (init.ok) candidates.push(...specUrlsFrom(await init.text(), uiUrl));
    } catch {
      /* Finns inte alltid. */
    }

    for (const url of [...new Set(candidates)]) {
      const found = await readSpec(url, fetchImpl);
      if (found) return found;
      tried.push(url);
    }
  }

  for (const url of SPEC_FALLBACKS) {
    const found = await readSpec(url, fetchImpl);
    if (found) return found;
    tried.push(url);
  }

  return {
    url: SWAGGER_UI_URLS[0],
    outcome: "missing",
    // Vilka som provats, så nästa gissning inte upprepar en av dem.
    paths: tried.map((t) => `provad: ${t}`),
  };
}

export async function probeTenant(
  fetchImpl: typeof fetch = fetch,
  options: ProbeOptions = {},
): Promise<TenantReport> {
  const val = { ...ALLT, ...options };
  const ranAt = new Date().toISOString();
  const credentials = credentialsFromEnv();
  const spec = val.spec ? await probeSpec(fetchImpl) : undefined;

  if (!credentials) {
    return {
      hasCredentials: false,
      token: { outcome: "not-run", scopes: READ_SCOPES },
      spec,
      endpoints: allPaths(null, val.paths).map(([path, label]) => ({
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
        endpoints: allPaths(null, val.paths).map(([path, label]) => ({
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
  /* Bara när något i urvalet faktiskt behöver ett id. Anropet kostar
     ett av de få vi har råd med. */
  if (val.sampleEmployee) {
    try {
      const r = await client.request<unknown>("/v1/employees", {
        limit: 1,
        scopes,
      });
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
  }

  for (const [path, label] of allPaths(sampleEmployeeId, val.paths)) {
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
  const trips =
    val.trips &&
    endpoints.some((e) => e.path === "/v1/trips" && e.outcome !== "missing")
      ? await probeTrips(client, scopes)
      : undefined;

  const grouping =
    val.grouping &&
    endpoints.some((e) => e.path === "/v1/employees" && e.outcome === "ok")
      ? await probeGrouping(client, scopes)
      : undefined;

  /* Specen listar /v1/shifts/ och scopet är beviljat, men vägen svarar
     404. Då provas varianterna var för sig i stället för att jag gissar
     en gång till på vad som skiljer. */
  const shiftsMissing = endpoints.some(
    (e) => e.path === "/v1/shifts/" && e.outcome === "missing",
  );
  const shiftVariants =
    val.shiftVariants && shiftsMissing && spec?.outcome === "ok"
      ? await probeShiftVariants(
          await getAccessToken(credentials, scopes, fetchImpl),
          spec,
          sampleEmployeeId,
          fetchImpl,
        ).catch(() => undefined)
      : undefined;

  return {
    hasCredentials: true,
    trips,
    shiftVariants,
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
