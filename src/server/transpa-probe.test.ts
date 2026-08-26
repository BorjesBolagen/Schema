import { describe, expect, it, beforeEach } from "vitest";
import { probeTenant } from "./transpa-probe";
import { clearTokenCache } from "@/lib/transpa/auth";

const env = {
  TRANSPA_CLIENT_ID: "id",
  TRANSPA_CLIENT_SECRET: "hemlis",
  TRANSPA_TENANT_ID: "t1",
};

/** Fejkar både token-endpointen, specen och API:t. */
function fakeFetch(handler: (url: string) => Response) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("connect/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }));
    }
    if (url.includes("doc/openapi")) return new Response("", { status: 404 });
    return handler(url);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearTokenCache();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
});

describe("probeTenant", () => {
  it("visar fältnamnen i första raden för /v1/trips utan att röra värdena", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("/v1/trips")) {
        return new Response(
          JSON.stringify({
            items: [{ id: "t1", employeeId: "e1", vehicleId: "v1", startDateTime: "2026-01-01" }],
            cursor: { nextToken: null },
          }),
        );
      }
      return new Response(JSON.stringify({ items: [], cursor: { nextToken: null } }));
    });

    const report = await probeTenant(fetchImpl);
    const trips = report.endpoints.find((e) => e.path === "/v1/trips")!;

    expect(trips.outcome).toBe("ok");
    expect(trips.sampleKeys).toEqual(["employeeId", "id", "startDateTime", "vehicleId"]);
    // Vilken nyckel raderna låg under redovisas i stället för att antas.
    expect(trips.rowKey).toBe("items");
    expect(trips.sample).toBe(1);
    // Bara fältnamnen — inget av värdena "t1", "e1" osv i utdatat.
    expect(JSON.stringify(trips)).not.toContain("e1");
  });

  it("lämnar sampleKeys osatt för endpoints utanför listan, och tomt när svaret är tomt", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ items: [], cursor: { nextToken: null } })));
    const report = await probeTenant(fetchImpl);

    const trips = report.endpoints.find((e) => e.path === "/v1/trips")!;
    expect(trips.outcome).toBe("empty");
    expect(trips.sampleKeys).toEqual([]);

    /* stationPlaces stod här förut, men den visar numera fältnamn —
       poängen är en väg som avsiktligt står utanför listan. */
    const alive = report.endpoints.find((e) => e.path === "/v1/alive")!;
    expect(alive.sampleKeys).toBeUndefined();
  });
});

describe("jakten på passen", () => {
  it("hittar passen under en person och använder ett riktigt id", async () => {
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      const path = new URL(url).pathname;
      sedda.push(path);
      if (path.endsWith("/v1/employees")) {
        return new Response(
          JSON.stringify({ items: [{ id: "emp-42", firstName: "A" }], cursor: { nextToken: null } }),
        );
      }
      // Bara underresursen finns — precis som i verkligheten, där
      // /v1/shifts svarar 404 trots att scopet är beviljat.
      if (path === "/publicApi/v1/employees/emp-42/shifts") {
        return new Response(
          JSON.stringify({ items: [{ date: "2026-08-24", startTime: "06:00" }], cursor: {} }),
        );
      }
      return new Response(JSON.stringify({ title: "Not found" }), { status: 404 });
    });

    const report = await probeTenant(fetchImpl);
    const träff = report.endpoints.find((e) => e.path === "/v1/employees/emp-42/shifts");

    expect(träff?.outcome).toBe("ok");
    // Id:t ska komma från personallistan, inte vara påhittat.
    expect(sedda).toContain("/publicApi/v1/employees/emp-42/shifts");
  });

  it("anropar aldrig en väg med platshållaren kvar", async () => {
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      sedda.push(new URL(url).pathname);
      return new Response(JSON.stringify({ items: [], cursor: {} }));
    });

    const report = await probeTenant(fetchImpl);
    // Raden syns, men vägen anropas inte: en 404 på "{id}" betyder inget.
    expect(sedda.some((p) => p.includes("{id}"))).toBe(false);
    const kvar = report.endpoints.find((e) => e.path.includes("{id}"));
    expect(kvar?.outcome).toBe("not-run");
    expect(kvar?.detail).toMatch(/inget person-id/i);
  });
});

describe("person-id ur svaret", () => {
  it("hittar id:t även när fälten är PascalCase", async () => {
    // Vismas genererade klient är PascalCase (Id, FirstName). Antar man
    // camelCase blir id:t null, underresurserna provas aldrig, och
    // raderna såg tidigare ut att inte ens finnas.
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      const path = new URL(url).pathname;
      sedda.push(path);
      if (path.endsWith("/v1/employees")) {
        return new Response(
          JSON.stringify({
            items: [{ Id: "PASCAL-1", FirstName: "A", LastName: "B" }],
            cursor: { nextToken: null },
          }),
        );
      }
      return new Response(JSON.stringify({ title: "Not found" }), { status: 404 });
    });

    const report = await probeTenant(fetchImpl);
    expect(report.employeeSample?.id).toBe("PASCAL-1");
    expect(report.employeeSample?.keys).toContain("Id");
    expect(sedda).toContain("/publicApi/v1/employees/PASCAL-1/shifts");
  });

  it("listar underresurserna även när inget id gick att plocka ut", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ items: [], cursor: {} })));
    const report = await probeTenant(fetchImpl);

    expect(report.employeeSample?.id).toBeNull();
    // Raden ska finnas kvar, med platshållaren synlig — att den tyst
    // försvann gjorde det omöjligt att se att den aldrig provades.
    expect(report.endpoints.some((e) => e.path.includes("{id}"))).toBe(true);
  });
});

describe("samma vägar redovisas oavsett hur långt körningen kom", () => {
  it("listar pass-kandidaterna även när token-hämtningen misslyckas", async () => {
    // Tidigare byggdes listan på två ställen, och den här vägen saknade
    // pass-kandidaterna helt — de såg ut att inte finnas.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("connect/token")) {
        return new Response("nej", { status: 401 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const report = await probeTenant(fetchImpl);
    expect(report.token.outcome).not.toBe("ok");
    expect(report.endpoints.some((e) => e.label === "Pass under en person")).toBe(true);
    expect(report.endpoints.every((e) => e.outcome === "not-run")).toBe(true);
  });

  /* 200 med en form vi inte känner igen är inte "tomt svar". Det var
     precis så /v1/employees såg ut när raderna låg under items och
     koden läste data: sidan sa att svaret saknade fält. */
  it("skiljer okänt kuvert från tomt svar", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ result: [{ id: "x" }] })));
    const report = await probeTenant(fetchImpl);
    const employees = report.endpoints.find((e) => e.path === "/v1/employees")!;

    expect(employees.outcome).toBe("error");
    expect(employees.status).toBe(200);
    expect(employees.detail).toMatch(/varken items eller data/);
  });
});
