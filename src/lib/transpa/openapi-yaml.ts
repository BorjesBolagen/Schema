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

export interface SpecOperation {
  method: string;
  summary?: string;
  tags?: string[];
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
      continue;
    }

    if (!current) continue;

    // Metoden: en nivå in under vägen.
    if (kv && METHODS.includes(kv.key.toLowerCase()) && indent > currentIndent) {
      if (operationIndent === -1) operationIndent = indent;
      if (indent === operationIndent) {
        operation = { method: kv.key.toUpperCase() };
        current.operations.push(operation);
        inTags = false;
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

    if (kv && indent > operationIndent) {
      if (kv.key === "summary" && kv.value) operation.summary = kv.value;
      // Beskrivningen får duga när sammanfattning saknas.
      if (kv.key === "description" && kv.value && !operation.summary) operation.summary = kv.value;
      if (kv.key === "tags") inTags = kv.value === "";
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
        : p.operations.map(
            (op) => `${p.path}  [${op.method}]${op.summary ? `  ${op.summary}` : ""}`,
          ),
    )
    .sort();
}
