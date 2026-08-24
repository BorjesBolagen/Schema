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
