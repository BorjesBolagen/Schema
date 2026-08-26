import { describe, expect, it, beforeEach } from "vitest";
import { TranspaClient, TranspaApiError, TranspaShapeError, rowsOf } from "./client";
import { clearTokenCache } from "./auth";

const credentials = { clientId: "id", clientSecret: "hemlis", tenantId: "t1" };

/** Fejkar både token-endpointen och API:t. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("connect/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }));
    }
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/* Kuvertet TransPA faktiskt skickar: raderna under `items`, enligt
   Vismas egen OpenAPI-modell. Testet använde tidigare `data` — samma
   felantagande som koden — och därför gick det igenom medan varje
   riktig lista blev tom. */
const listPage = (items: unknown[], nextToken: string | null) =>
  new Response(JSON.stringify({ items, cursor: { nextToken } }));

beforeEach(() => clearTokenCache());

describe("TranspaClient", () => {
  it("skickar token och filter", async () => {
    const { impl, calls } = fakeFetch(() => listPage([{ id: "1" }], null));
    const client = new TranspaClient({ credentials, fetchImpl: impl });
    await client.list("/v1/vehicles", { filter: "id$eq:1", limit: 5 });

    const apiCall = calls.find((c) => c.includes("/v1/vehicles"))!;
    expect(apiCall).toContain("filter=id%24eq%3A1");
    expect(apiCall).toContain("limit=5");
  });

  it("följer markören och behåller filtret på nästa sida", async () => {
    const seen: string[] = [];
    const { impl } = fakeFetch((url) => {
      seen.push(url);
      return url.includes("cursor=sida2")
        ? listPage([{ id: "2" }], null)
        : listPage([{ id: "1" }], "sida2");
    });

    const rows = await new TranspaClient({ credentials, fetchImpl: impl })
      .list<{ id: string }>("/v1/vehicles", { filter: "isActive$eq:true" });

    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(seen).toHaveLength(2);
    // Filtret måste följa med, annars ger nästa sida fel urval.
    expect(seen[1]).toContain("filter=isActive%24eq%3Atrue");
    expect(seen[1]).toContain("cursor=sida2");
  });

  it("stannar när markören pekar tillbaka på sig själv", async () => {
    let n = 0;
    const { impl } = fakeFetch(() => {
      n++;
      return listPage([{ id: String(n) }], "samma");
    });
    const rows = await new TranspaClient({ credentials, fetchImpl: impl })
      .list("/v1/vehicles", { cursor: "samma" });
    expect(rows).toHaveLength(1);
  });

  it("återanvänder token mellan anrop", async () => {
    const { impl, calls } = fakeFetch(() => listPage([], null));
    const client = new TranspaClient({ credentials, fetchImpl: impl });
    await client.list("/v1/vehicles");
    await client.list("/v1/employees");
    expect(calls.filter((c) => c.includes("connect/token"))).toHaveLength(1);
  });

  it("lyfter fram detaljen ur problem+json", async () => {
    const { impl } = fakeFetch(() =>
      new Response(JSON.stringify({ title: "Forbidden", detail: "Saknar scope transpaapi:trips:read", status: 403 }), { status: 403 }));

    await expect(new TranspaClient({ credentials, fetchImpl: impl }).request("/v1/trips"))
      .rejects.toThrowError(/Saknar scope/);
  });

  it("bär med statuskoden i felet", async () => {
    const { impl } = fakeFetch(() => new Response("nix", { status: 404 }));
    const client = new TranspaClient({ credentials, fetchImpl: impl });
    await expect(client.request("/v1/shifts")).rejects.toMatchObject({
      name: "TranspaApiError",
      status: 404,
      path: "/v1/shifts",
    });
  });

  it("läser raderna ur items, inte ur data", async () => {
    const { impl } = fakeFetch(
      () => new Response(JSON.stringify({ items: [{ id: "a" }, { id: "b" }], cursor: { nextToken: null } })),
    );
    const rows = await new TranspaClient({ credentials, fetchImpl: impl }).list("/v1/employees");
    expect(rows).toHaveLength(2);
  });

  /* Den genererade klienten är föråldrad, så live-API:t kan skilja sig
     från modellen. Faller det tillbaka ska det ändå fungera. */
  it("godtar data som andrahandsnyckel", async () => {
    const { impl } = fakeFetch(
      () => new Response(JSON.stringify({ data: [{ id: "a" }], cursor: { nextToken: null } })),
    );
    const rows = await new TranspaClient({ credentials, fetchImpl: impl }).list("/v1/employees");
    expect(rows).toHaveLength(1);
  });

  /* Det här är felet som kostade oss en synk som rapporterade lyckat
     utan att ha hämtat något. En form vi inte känner igen ska smälla,
     inte ge tomt. */
  it("kastar hellre än att returnera tomt när kuvertet inte känns igen", async () => {
    const { impl } = fakeFetch(() => new Response(JSON.stringify({ result: [{ id: "a" }] })));
    await expect(new TranspaClient({ credentials, fetchImpl: impl }).list("/v1/employees"))
      .rejects.toBeInstanceOf(TranspaShapeError);
  });

  it("skiljer en tom sida från en okänd form", async () => {
    expect(rowsOf({ items: [] }, "/v1/employees")).toEqual({ rows: [], key: "items" });
    expect(() => rowsOf({}, "/v1/employees")).toThrowError(/varken items eller data/);
  });
});
