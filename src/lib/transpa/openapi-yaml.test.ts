import { describe, expect, it } from "vitest";
import { describeSpecPaths, parseOpenApiYaml } from "./openapi-yaml";

/**
 * TransPA:s spec ligger som openapi.yaml. Adressen fanns i
 * Swagger-UI-sidan hela tiden, men hämtningen försökte tolka den som
 * JSON och gav upp — och sidan rapporterade att specen inte gick att
 * hämta.
 *
 * Sammanfattningarna är det som betyder mest: namnet timeReports säger
 * inte om resursen bär planerad eller rapporterad tid, men specens egen
 * beskrivning gör det.
 */
const SPEC = `openapi: 3.0.1
info:
  title: TransPA Public API
  version: 1.4.2
servers:
  - url: https://api.mytranspa.com/publicApi
paths:
  /v1/employees:
    get:
      tags:
        - employees
      summary: "[Not ready] Return a list of Employees"
      parameters:
        - name: limit
          in: query
  /v1/shifts/:
    get:
      tags:
        - timereports and shifts
      summary: Return a list of Shifts
      parameters:
        - name: from
          in: query
          required: true
          schema:
            type: string
        - name: to
          in: query
          required: true
        - name: limit
          in: query
          required: false
    post:
      summary: Create a shift
  /v1/vehicles:
    get:
      summary: Return a list of Vehicles
    put:
      summary: Update a Vehicle
`;

describe("parseOpenApiYaml", () => {
  const spec = parseOpenApiYaml(SPEC);

  it("läser titel och version", () => {
    expect(spec.title).toBe("TransPA Public API");
    expect(spec.version).toBe("1.4.2");
  });

  it("läser servern, så specen går att känna igen som TransPA:s", () => {
    expect(spec.servers).toEqual(["https://api.mytranspa.com/publicApi"]);
  });

  it("hittar varje väg", () => {
    expect(spec.paths.map((p) => p.path)).toEqual([
      "/v1/employees",
      "/v1/shifts/",
      "/v1/vehicles",
    ]);
  });

  it("hittar flera metoder på samma väg", () => {
    const shifts = spec.paths.find((p) => p.path === "/v1/shifts/")!;
    expect(shifts.operations.map((o) => o.method)).toEqual(["GET", "POST"]);
  });

  /* Frågan som inte går att avgöra ur namnet: planerad eller rapporterad
     tid? Sammanfattningen svarar. */
  it("bär med sig sammanfattningen", () => {
    const shifts = spec.paths.find((p) => p.path === "/v1/shifts/")!;
    expect(shifts.operations[0].summary).toBe("Return a list of Shifts");
  });

  it("bär med sig taggen", () => {
    const shifts = spec.paths.find((p) => p.path === "/v1/shifts/")!;
    expect(shifts.operations[0].tags).toEqual(["timereports and shifts"]);
  });

  it("tar bort citattecken runt värden", () => {
    const employees = spec.paths.find((p) => p.path === "/v1/employees")!;
    expect(employees.operations[0].summary).toBe("[Not ready] Return a list of Employees");
  });

  /* Parametrar ligger djupare än operationen och får inte tas för
     ytterligare vägar eller metoder. */
  it("förväxlar inte parametrar med vägar", () => {
    expect(spec.paths).toHaveLength(3);
    const employees = spec.paths.find((p) => p.path === "/v1/employees")!;
    expect(employees.operations).toHaveLength(1);
  });

  it("tål en tom eller trasig spec i stället för att spränga", () => {
    expect(parseOpenApiYaml("").paths).toEqual([]);
    expect(parseOpenApiYaml("bara: text\ninget: annat").paths).toEqual([]);
  });

  it("klarar fyra stegs indrag lika bra som två", () => {
    const wide = `paths:
    /v1/alive:
        get:
            summary: Liveness
`;
    const parsed = parseOpenApiYaml(wide);
    expect(parsed.paths[0].path).toBe("/v1/alive");
    expect(parsed.paths[0].operations[0].summary).toBe("Liveness");
  });
});

describe("describeSpecPaths", () => {
  it("skriver en rad per väg och metod, med sammanfattningen", () => {
    const lines = describeSpecPaths(parseOpenApiYaml(SPEC));
    expect(lines).toContain(
      "/v1/shifts/  [GET]  Return a list of Shifts  · krävs: from, to",
    );
    expect(lines).toContain("/v1/vehicles  [PUT]  Update a Vehicle");
  });

  it("visar en väg utan operationer som bara vägen", () => {
    const lines = describeSpecPaths({ servers: [], paths: [{ path: "/v1/x", operations: [] }] });
    expect(lines).toEqual(["/v1/x"]);
  });

  /**
   * Det som förklarar en 404 på en väg som står i specen: anropet
   * saknar en parameter API:t kräver. Fyra tidigare slutsatser föll på
   * att jag inte läste vad som faktiskt krävdes.
   */
  it("läser obligatoriska parametrar", () => {
    const shifts = parseOpenApiYaml(SPEC).paths.find((p) => p.path === "/v1/shifts/")!;
    const get = shifts.operations[0];

    expect(get.parameters.map((x) => x.name)).toEqual(["from", "to", "limit"]);
    expect(get.parameters.filter((x) => x.required).map((x) => x.name)).toEqual(["from", "to"]);
    expect(get.parameters[0].location).toBe("query");
  });

  it("förväxlar inte parametrarnas schema med fler parametrar", () => {
    const shifts = parseOpenApiYaml(SPEC).paths.find((p) => p.path === "/v1/shifts/")!;
    expect(shifts.operations[0].parameters).toHaveLength(3);
  });

  it("låter parameterlistan ta slut vid nästa operation", () => {
    const shifts = parseOpenApiYaml(SPEC).paths.find((p) => p.path === "/v1/shifts/")!;
    expect(shifts.operations[1].method).toBe("POST");
    expect(shifts.operations[1].parameters).toEqual([]);
  });

  /* En spec som delar parametrar via $ref har inga namn på plats. Utan
     det här ser den ut som en spec helt utan parametrar — och då går
     det inte att skilja "inga krav" från "tolken ser dem inte". */
  it("bär vidare en $ref-parameter som sitt referensnamn", () => {
    const withRefs = `paths:
  /v1/shifts/:
    get:
      summary: Return a list of Shifts
      parameters:
        - $ref: '#/components/parameters/FromDate'
        - $ref: '#/components/parameters/ToDate'
`;
    const get = parseOpenApiYaml(withRefs).paths[0].operations[0];
    expect(get.parameters.map((x) => x.name)).toEqual(["FromDate", "ToDate"]);
    expect(get.parameters[0].location).toBe("$ref");
  });

  /* Riktiga körningen visade 429Throttling som obligatorisk parameter
     på POST- och PUT-operationer som inte har några parametrar alls.
     Den kom ur responses:, inte ur parameters:. */
  it("plockar inte upp responses som parametrar", () => {
    const spec = `paths:
  /v1/shifts/:
    get:
      summary: Return a list of Shifts
      parameters:
        - name: startDateTimeAfter
          in: query
          required: true
      responses:
        '200':
          description: OK
        '429':
          $ref: '#/components/responses/429Throttling'
    post:
      summary: Create a shift
      responses:
        '429':
          $ref: '#/components/responses/429Throttling'
`;
    const parsed = parseOpenApiYaml(spec).paths[0];
    expect(parsed.operations[0].parameters.map((x) => x.name)).toEqual(["startDateTimeAfter"]);
    expect(parsed.operations[1].parameters).toEqual([]);
  });

  /**
   * Formen TransPA:s spec faktiskt har: delade parametrar via $ref
   * först, sedan en namngiven med description och schema efter
   * required — och responses direkt efteråt.
   *
   * Att avsluta parameterlistan på nyckelnamn i stället för på indrag
   * bröt den mitt i första parametern, så startDateTimeAfter aldrig
   * blev markerad som obligatorisk. Varianten som skulle bevisa
   * passvägen genererades då aldrig.
   */
  it("läser en parameter vars description och schema följer efter required", () => {
    const real = `paths:
  /v1/shifts/:
    get:
      tags:
        - timereports and shifts
      summary: Return a list of Shifts
      operationId: get-shifts
      parameters:
        - $ref: '#/components/parameters/cursorQueryParameter'
        - $ref: '#/components/parameters/limitParameter'
        - name: startDateTimeAfter
          description: Only shifts starting after this point in time
          in: query
          required: true
          schema:
            type: string
            format: date-time
      responses:
        '200':
          description: OK
        '429':
          $ref: '#/components/responses/429Throttling'
`;
    const get = parseOpenApiYaml(real).paths[0].operations[0];

    expect(get.parameters.map((x) => x.name)).toEqual([
      "cursorQueryParameter",
      "limitParameter",
      "startDateTimeAfter",
    ]);

    const required = get.parameters.find((x) => x.name === "startDateTimeAfter")!;
    expect(required.location).toBe("query");
    expect(required.required).toBe(true);

    // Och inget ur responses smyger in.
    expect(get.parameters.map((x) => x.name)).not.toContain("429Throttling");
  });
});
