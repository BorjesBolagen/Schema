import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { clearTokenCache } from "@/lib/transpa/auth";
import { TEST_EMPLOYEE_ID } from "@/lib/transpa/write-guard";
import { recentWrites, sendShiftMove, writableEmployees } from "./shift-write";

/**
 * Skrivvägen mot Börjes produktionstenant.
 *
 * Det som provas hårdast är inte att en flytt går fram, utan att den
 * *inte* går fram för någon annan än testpersonen. Ett fel här flyttar
 * en riktig chaufförs pass, och det märks först när någon kör fel.
 */

let db: Db;
let prov: string;
let riktig: string;
let user: string;
let tenant: string;

beforeEach(async () => {
  clearTokenCache();
  process.env.TRANSPA_CLIENT_ID = "id";
  process.env.TRANSPA_CLIENT_SECRET = "hemlis";
  process.env.TRANSPA_TENANT_ID = "t1";

  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);

  const [t] = await db
    .insert(schema.transpaTenant)
    .values({ tenantId: "t1", name: "Börjes" })
    .returning();
  tenant = t.id;

  const [u] = await db
    .insert(schema.appUser)
    .values({ email: "a@b.se", name: "Admin", role: "admin" })
    .returning();
  user = u.id;

  const [p] = await db
    .insert(schema.employee)
    .values({
      firstName: "Prov",
      lastName: "Provsson",
      transpaId: TEST_EMPLOYEE_ID,
      transpaTenantId: tenant,
    })
    .returning();
  prov = p.id;

  const [r] = await db
    .insert(schema.employee)
    .values({
      firstName: "Bill",
      lastName: "Erlandsson",
      transpaId: "40e6783e-af1a-4d48-84da-f07b4f65f834",
      transpaTenantId: tenant,
    })
    .returning();
  riktig = r.id;
});

afterAll(async () => {
  if (db) await closeDb(db);
});

/** Fejkar token, GET av passet och PUT:en — och räknar vad som anropades. */
function fakeApi(over: { putStatus?: number; getStatus?: number; getBody?: string } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("connect/token")) {
      return new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }),
      );
    }
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if ((init?.method ?? "GET") === "GET") {
      if (over.getStatus && over.getStatus !== 200) {
        return new Response(over.getBody ?? "", { status: over.getStatus });
      }
      return new Response(
        JSON.stringify({
          id: "s1",
          employeeId: TEST_EMPLOYEE_ID,
          startDateTime: "2026-08-19T14:00:00.000Z",
          partsOfDay: [{ endDateTime: "2026-08-20T01:00:00.000Z", vehicleId: "v1" }],
          breaks: [],
          adjustedWorkTimeInMinutes: 600,
          isExtraShift: false,
        }),
      );
    }
    const status = over.putStatus ?? 200;
    return new Response(status === 200 ? "{}" : JSON.stringify({ detail: "nej" }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const flytt = (employeeId: string) => ({
  employeeId,
  transpaShiftId: "s1",
  from: "2026-08-19",
  to: "2026-08-20",
  userId: user,
});

describe("spärren", () => {
  /* Det viktigaste testet i filen. */
  it("skickar ingenting alls för en riktig chaufför", async () => {
    const { impl, calls } = fakeApi();
    const result = await sendShiftMove(flytt(riktig), impl, db);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("står inte på tillåtelselistan");
    expect(calls).toEqual([]); // inte ens en tokenhämtning mot passvägen
  });

  it("skriver ändå ned försöket", async () => {
    const { impl } = fakeApi();
    await sendShiftMove(flytt(riktig), impl, db);

    const rader = await recentWrites(10, db);
    expect(rader).toHaveLength(1);
    expect(rader[0].status).toBe("failed");
    expect(rader[0].summary).toContain("Bill Erlandsson");
  });

  it("släpper igenom testpersonen", async () => {
    const { impl, calls } = fakeApi();
    const result = await sendShiftMove(flytt(prov), impl, db);

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
  });
});

describe("flytten", () => {
  it("skjuter passet ett dygn och behåller klockslaget", async () => {
    const { impl, calls } = fakeApi();
    await sendShiftMove(flytt(prov), impl, db);

    const put = calls.find((c) => c.method === "PUT")!;
    const body = put.body as { startDateTime: string; partsOfDay: Array<{ endDateTime: string }> };
    expect(body.startDateTime).toBe("2026-08-20T14:00:00.000Z");
    expect(body.partsOfDay[0].endDateTime).toBe("2026-08-21T01:00:00.000Z");
  });

  /* Vår kopia kan vara timmar gammal, och PUT ersätter hela passet. */
  it("hämtar passet färskt innan det skrivs", async () => {
    const { impl, calls } = fakeApi();
    await sendShiftMove(flytt(prov), impl, db);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/v1/shifts/s1");
  });

  /**
   * Rätt scope till rätt anrop.
   *
   * En flytt är två anrop: läs tillbaka passet, skriv det. De behöver
   * olika scope, och skriv-scopet bär inte läsrätt. Skickades
   * skriv-scopen till hämtningen svarade TransPA 403 med "Claim value
   * mismatch: scope=transpaapi:shifts:read" — ett fel som lät som att
   * läsning vore nekad när det var vår tokenbegäran som var fel.
   *
   * Det gamla testet såg bara den *sista* tokenbegäran och var därför
   * grönt hela tiden. Nu paras varje begäran ihop med anropet den
   * gjordes för.
   */
  it("begär läs-scope till hämtningen och skriv-scope till skrivningen", async () => {
    const scopes: string[] = [];
    const anrop: Array<{ method: string; scope: string }> = [];

    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("connect/token")) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        scopes.push(body.get("scope") ?? "");
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }),
        );
      }
      /* Tokenhämtningen sker direkt före det anrop som behövde den. */
      anrop.push({ method: init?.method ?? "GET", scope: scopes[scopes.length - 1] ?? "" });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify({
            id: "s1",
            employeeId: TEST_EMPLOYEE_ID,
            startDateTime: "2026-08-19T14:00:00.000Z",
            partsOfDay: [{ endDateTime: "2026-08-20T01:00:00.000Z" }],
            adjustedWorkTimeInMinutes: 600,
          }),
        );
      }
      return new Response("{}");
    }) as unknown as typeof fetch;

    const result = await sendShiftMove(flytt(prov), impl, db);
    expect(result.ok).toBe(true);

    const get = anrop.find((a) => a.method === "GET")!;
    const put = anrop.find((a) => a.method === "PUT")!;
    expect(get.scope).toContain("transpaapi:shifts:read");
    expect(get.scope).not.toContain("transpaapi:shifts:write");
    expect(put.scope).toContain("transpaapi:shifts:write");
  });

  it("sparar kroppen som skickades", async () => {
    const { impl } = fakeApi();
    await sendShiftMove(flytt(prov), impl, db);

    const [rad] = await recentWrites(1, db);
    expect(rad.status).toBe("ok");
    expect(rad.method).toBe("PUT");
    expect(rad.requestBody).toContain("2026-08-20T14:00:00.000Z");
    expect(rad.userId).toBe(user);
  });

  it("rapporterar ett fel från TransPA i klartext", async () => {
    const { impl } = fakeApi({ putStatus: 403 });
    const result = await sendShiftMove(flytt(prov), impl, db);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
    const [rad] = await recentWrites(1, db);
    expect(rad.status).toBe("failed");
    expect(rad.responseStatus).toBe(403);
  });
});

/**
 * Vad felet säger.
 *
 * Johan tryckte på knappen och fick "0 skickade, 1 misslyckades" — och
 * ingenting mer, någonstans. Felet fångas här och sparas, så det når
 * aldrig Vercels logg, och Supabase loggar inte ett lyckat INSERT. Står
 * skälet inte i meddelandet står det ingenstans.
 */
describe("felet ska gå att förstå", () => {
  it("säger vilket av de två anropen som föll", async () => {
    const läsfel = await sendShiftMove(
      flytt(prov),
      fakeApi({ getStatus: 404, getBody: '{"detail":"Shift not found"}' }).impl,
      db,
    );
    expect(läsfel.message).toContain("läsa tillbaka passet");

    const skrivfel = await sendShiftMove(flytt(prov), fakeApi({ putStatus: 403 }).impl, db);
    expect(skrivfel.message).toContain("skriva passet");
  });

  /* Ett 404 utan problem+json gav förut bara "404 från /v1/shifts/s1".
     Råsvaret är då det enda som finns att gå på. */
  it("tar med råsvaret när det inte är problem+json", async () => {
    const { impl } = fakeApi({ getStatus: 404, getBody: "<html>Not Found</html>" });
    const result = await sendShiftMove(flytt(prov), impl, db);
    expect(result.message).toContain("Not Found");
  });

  it("säger tomt svar i stället för att tiga när kroppen är tom", async () => {
    const { impl } = fakeApi({ getStatus: 500, getBody: "" });
    const result = await sendShiftMove(flytt(prov), impl, db);
    expect(result.message).toContain("tomt svar");
  });

  /* Skälet måste finnas kvar efter en omladdning — det är hela
     poängen med utkorgen. */
  it("sparar skälet i utkorgen, inte bara i svaret", async () => {
    const { impl } = fakeApi({ putStatus: 403 });
    await sendShiftMove(flytt(prov), impl, db);
    const [rad] = await recentWrites(1, db);
    expect(rad.responseBody).toContain("skriva passet");
  });

  /* Fallande sortering före limit. Med stigande sortering plockades de
     äldsta raderna och vändes sedan — loggen visade alltså de första
     skrivningarna någonsin i stället för de senaste. */
  it("visar de senaste skrivningarna, inte de första", async () => {
    for (let i = 0; i < 4; i++) {
      await sendShiftMove(
        { ...flytt(prov), to: `2026-08-2${i}` },
        fakeApi({ putStatus: 403 }).impl,
        db,
      );
    }
    const [senast] = await recentWrites(2, db);
    expect(senast.summary).toContain("2026-08-23");
  });
});

describe("writableEmployees", () => {
  it("pekar ut vilka som får skrivas till", async () => {
    const skrivbara = await writableEmployees([prov, riktig], db);
    expect([...skrivbara]).toEqual([prov]);
  });

  it("ger tom mängd för en tom lista", async () => {
    expect(await writableEmployees([], db)).toEqual(new Set());
  });
});
