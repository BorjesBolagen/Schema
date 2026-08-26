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
            data: [{ id: "t1", employeeId: "e1", vehicleId: "v1", startDateTime: "2026-01-01" }],
            cursor: { nextToken: null },
          }),
        );
      }
      return new Response(JSON.stringify({ data: [], cursor: { nextToken: null } }));
    });

    const report = await probeTenant(fetchImpl);
    const trips = report.endpoints.find((e) => e.path === "/v1/trips")!;

    expect(trips.outcome).toBe("ok");
    expect(trips.sampleKeys).toEqual(["employeeId", "id", "startDateTime", "vehicleId"]);
    // Bara fältnamnen — inget av värdena "t1", "e1" osv i utdatat.
    expect(JSON.stringify(trips)).not.toContain("e1");
  });

  it("lämnar sampleKeys osatt för endpoints utanför listan, och tomt när svaret är tomt", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ data: [], cursor: { nextToken: null } })));
    const report = await probeTenant(fetchImpl);

    const trips = report.endpoints.find((e) => e.path === "/v1/trips")!;
    expect(trips.outcome).toBe("empty");
    expect(trips.sampleKeys).toEqual([]);

    const vehicles = report.endpoints.find((e) => e.path === "/v1/vehicles")!;
    expect(vehicles.sampleKeys).toBeUndefined();
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
          JSON.stringify({ data: [{ id: "emp-42", firstName: "A" }], cursor: { nextToken: null } }),
        );
      }
      // Bara underresursen finns — precis som i verkligheten, där
      // /v1/shifts svarar 404 trots att scopet är beviljat.
      if (path === "/publicApi/v1/employees/emp-42/shifts") {
        return new Response(
          JSON.stringify({ data: [{ date: "2026-08-24", startTime: "06:00" }], cursor: {} }),
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

  it("provar inte underresurser när ingen person gick att hämta", async () => {
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      sedda.push(new URL(url).pathname);
      return new Response(JSON.stringify({ data: [], cursor: {} }));
    });

    await probeTenant(fetchImpl);
    expect(sedda.some((p) => p.includes("{id}"))).toBe(false);
    expect(sedda.some((p) => /\/v1\/employees\/[^/]+\/shifts/.test(p))).toBe(false);
  });
});
