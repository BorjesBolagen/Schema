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
  /v1/timeReports/shifts:
    get:
      tags:
        - timereports and shifts
      summary: Get planned shifts for an employee
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
      "/v1/timeReports/shifts",
      "/v1/vehicles",
    ]);
  });

  it("hittar flera metoder på samma väg", () => {
    const shifts = spec.paths.find((p) => p.path === "/v1/timeReports/shifts")!;
    expect(shifts.operations.map((o) => o.method)).toEqual(["GET", "POST"]);
  });

  /* Frågan som inte går att avgöra ur namnet: planerad eller rapporterad
     tid? Sammanfattningen svarar. */
  it("bär med sig sammanfattningen", () => {
    const shifts = spec.paths.find((p) => p.path === "/v1/timeReports/shifts")!;
    expect(shifts.operations[0].summary).toBe("Get planned shifts for an employee");
  });

  it("bär med sig taggen", () => {
    const shifts = spec.paths.find((p) => p.path === "/v1/timeReports/shifts")!;
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
    expect(lines).toContain("/v1/timeReports/shifts  [GET]  Get planned shifts for an employee");
    expect(lines).toContain("/v1/vehicles  [PUT]  Update a Vehicle");
  });

  it("visar en väg utan operationer som bara vägen", () => {
    const lines = describeSpecPaths({ servers: [], paths: [{ path: "/v1/x", operations: [] }] });
    expect(lines).toEqual(["/v1/x"]);
  });
});
