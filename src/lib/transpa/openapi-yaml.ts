/**
 * Precis så mycket YAML som en OpenAPI-spec kräver.
 *
 * TransPA:s spec ligger som `openapi.yaml`, inte JSON — adressen fanns i
 * Swagger-UI-sidan hela tiden, men hämtningen försökte tolka den som
 * JSON och gav upp. Ett helt YAML-bibliotek för en diagnostiksida vore
 * att dra in mycket för lite, så det här läser bara det som behövs:
 * titeln, versionen, och vägarna med sina metoder och sammanfattningar.
 *
 * Sammanfattningarna är hela poängen. Frågan om `/v1/timeReports/shifts`
 * bär planerad eller rapporterad tid går inte att avgöra ur namnet —
 * men specens egen beskrivning av operationen avgör den.
 */

export interface SpecParameter {
  name: string;
  /** query, path, header … */
  location?: string;
  required: boolean;
}

export interface SpecOperation {
  method: string;
  summary?: string;
  tags?: string[];
  /**
   * Parametrarna operationen tar.
   *
   * Läses för att en obligatorisk frågeparameter som saknas är en av de
   * få förklaringarna till att en väg som står i specen ändå svarar
   * 404 — och det är precis vad /v1/shifts/ gör.
   */
  parameters: SpecParameter[];
}

export interface SpecPath {
  path: string;
  operations: SpecOperation[];
}

export interface ParsedSpec {
  title?: string;
  version?: string;
  servers: string[];
  paths: SpecPath[];
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/** Parameterns egna nycklar. Allt annat hör till något som omger den. */
const PARAM_KEYS = ["name", "in", "required", "$ref"];

/** Indraget i tecken, med tabbar räknade som två steg. */
function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line)![0];
  return m.replace(/\t/g, "  ").length;
}

/** Strippar citattecken och avslutande kommentar från ett skalärt värde. */
function scalar(raw: string): string {
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
    (v.startsWith("'") && v.endsWith("'") && v.length > 1)
  ) {
    return v.slice(1, -1);
  }
  // Kommentar efter värdet, men bara när den står fritt — en brädgård
  // mitt i en text är inte en kommentar.
  const hash = v.indexOf(" #");
  if (hash >= 0) v = v.slice(0, hash);
  return v.trim();
}

/** En nyckel-värde-rad, eller null när raden är något annat. */
function keyValue(line: string): { key: string; value: string } | null {
  const body = line.trim();
  if (!body || body.startsWith("#") || body.startsWith("-")) return null;

  /* Vägar innehåller kolon i sällsynta fall, men nyckeln slutar alltid
     på det första kolon som följs av mellanslag eller radslut. */
  const m = /^(".*?"|'.*?'|[^:]+):(?:\s+(.*))?$/.exec(body);
  if (!m) return null;
  return { key: scalar(m[1]), value: m[2] === undefined ? "" : scalar(m[2]) };
}

/**
 * Läser en OpenAPI-spec i YAML.
 *
 * Tolkar inte YAML i allmänhet: ankare, flödesnotation och flerradiga
 * strängar hanteras inte. Det behövs inte — en genererad OpenAPI-spec
 * är blockformaterad, och det som inte känns igen hoppas över i stället
 * för att spränga hela läsningen.
 */
export function parseOpenApiYaml(text: string): ParsedSpec {
  const lines = text.split(/\r?\n/);
  const out: ParsedSpec = { servers: [], paths: [] };

  let section: "info" | "paths" | "servers" | null = null;
  let sectionIndent = 0;
  let current: SpecPath | null = null;
  let currentIndent = -1;
  let operation: SpecOperation | null = null;
  let operationIndent = -1;
  let inTags = false;
  let inParams = false;
  let param: SpecParameter | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = indentOf(line);

    // Tillbaka på toppnivå: en ny sektion börjar.
    if (indent === 0) {
      const kv = keyValue(line);
      section =
        kv?.key === "info" || kv?.key === "paths" || kv?.key === "servers" ? kv.key : null;
      sectionIndent = 0;
      current = null;
      operation = null;
      inTags = false;
      inParams = false;
      param = null;
      continue;
    }

    if (section === "info" && indent === sectionIndent + 2) {
      const kv = keyValue(line);
      if (kv?.key === "title") out.title = kv.value;
      if (kv?.key === "version") out.version = kv.value;
      continue;
    }

    if (section === "servers") {
      const m = /^\s*-?\s*url:\s*(.+)$/.exec(line);
      if (m) out.servers.push(scalar(m[1]));
      continue;
    }

    if (section !== "paths") continue;

    /* Vägen: första nivån under `paths:`, och den börjar med snedstreck.
       Indraget låses vid första vägen så djupare rader inte förväxlas. */
    const kv = keyValue(line);
    if (kv?.key.startsWith("/") && (currentIndent === -1 || indent === currentIndent)) {
      currentIndent = indent;
      current = { path: kv.key, operations: [] };
      out.paths.push(current);
      operation = null;
      inTags = false;
      inParams = false;
      param = null;
      continue;
    }

    if (!current) continue;

    // Metoden: en nivå in under vägen.
    if (kv && METHODS.includes(kv.key.toLowerCase()) && indent > currentIndent) {
      if (operationIndent === -1) operationIndent = indent;
      if (indent === operationIndent) {
        operation = { method: kv.key.toUpperCase(), parameters: [] };
        current.operations.push(operation);
        inTags = false;
        inParams = false;
        param = null;
        continue;
      }
    }

    if (!operation) continue;

    // Listposter under `tags:`.
    if (inTags) {
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (item) {
        operation.tags = [...(operation.tags ?? []), scalar(item[1])];
        continue;
      }
      inTags = false;
    }

    /* Parameterlistan. Varje post börjar med bindestreck och bär name,
       in och required på följande rader:

           parameters:
             - name: from
               in: query
               required: true

       En obligatorisk parameter som inte skickas är en av de få
       förklaringarna till att en väg som står i specen svarar 404. */
    if (inParams) {
      const item = /^(\s*)-\s*(.*)$/.exec(line);
      if (item) {
        param = { name: "", required: false };
        operation.parameters.push(param);
        const inline = keyValue(item[2]);
        if (inline?.key === "name") param.name = inline.value;
        if (inline?.key === "in") param.location = inline.value;
        /* En delad parameter skrivs som $ref och har inget namn på
           plats. Referensen bärs vidare som namn — annars ser en spec
           full av $ref ut som en spec helt utan parametrar. */
        if (inline?.key === "$ref") {
          param.name = inline.value.split("/").pop() ?? inline.value;
          param.location = "$ref";
        }
        continue;
      }
      /* Bara parameterns egna nycklar konsumeras här. Ett ovillkorligt
         continue svalde annars varje rad så länge en parameter var
         öppen — och då nådde responses: aldrig avslutsvillkoret nedan. */
      if (param && kv && PARAM_KEYS.includes(kv.key)) {
        if (kv.key === "$ref") {
          param.name = kv.value.split("/").pop() ?? kv.value;
          param.location = "$ref";
        }
        if (kv.key === "name") param.name = kv.value;
        if (kv.key === "in") param.location = kv.value;
        if (kv.key === "required") param.required = kv.value === "true";
        continue;
      }
      /* Listan tar slut vid nästa nyckel på operationens egen nivå — och
         bara där. Att också avsluta på nyckelnamn var fel: en parameter
         har själv en `description`, och listan bröts därför mitt i den
         första parametern, så startDateTimeAfter aldrig hann bli
         markerad som obligatorisk. Indraget är det som skiljer
         operationens nycklar från parameterns. */
      const ends = kv !== null && indent <= operationIndent + 2;
      if (ends) {
        inParams = false;
        param = null;
      } else {
        continue;
      }
    }

    if (kv && indent > operationIndent) {
      if (kv.key === "summary" && kv.value) operation.summary = kv.value;
      // Beskrivningen får duga när sammanfattning saknas.
      if (kv.key === "description" && kv.value && !operation.summary) operation.summary = kv.value;
      if (kv.key === "tags") inTags = kv.value === "";
      if (kv.key === "parameters") {
        inParams = kv.value === "";
        param = null;
      }
    }
  }

  return out;
}

/** En rad per väg och metod, som sidan visar dem. */
export function describeSpecPaths(spec: ParsedSpec): string[] {
  return spec.paths
    .flatMap((p) =>
      p.operations.length === 0
        ? [p.path]
        : p.operations.map((op) => {
            const required = op.parameters.filter((x) => x.required).map((x) => x.name);
            return (
              `${p.path}  [${op.method}]` +
              `${op.summary ? `  ${op.summary}` : ""}` +
              // Obligatoriska parametrar hör till vägens identitet: utan
              // dem är anropet inte samma anrop.
              `${required.length ? `  · krävs: ${required.join(", ")}` : ""}`
            );
          }),
    )
    .sort();
}
