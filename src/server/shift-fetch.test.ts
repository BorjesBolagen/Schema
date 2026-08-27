import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { fetchWeekShifts } from "./shift-fetch";

/**
 * Hämtningen skriver till databasen och läses sedan av tavlan, så den
 * provas mot en riktig databas. Det som ska bevisas är att en vecka
 * hämtas per person, att strukna pass städas bort, och att en person
 * som fallerar inte drar med sig de andra.
 */
let db: Db;

/** Fejkar token-endpointen och passvägen. */
function fakeApi(perPerson: Record<string, unknown[]>, failFor: string[] = []) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("connect/token")) {
      return new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }),
      );
    }
    calls.push(url);
    const who = /employees\/([^/]+)\/shifts/.exec(url)?.[1] ?? "";
    if (failFor.includes(who)) return new Response("nej", { status: 500 });
    return new Response(JSON.stringify({ items: perPerson[who] ?? [], cursor: {} }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const shift = (id: string, date: string, hour = 6) => ({
  id,
  startDateTime: `${date}T${String(hour).padStart(2, "0")}:00:00Z`,
  adjustedWorkTimeInMinutes: 480,
});

let anders: string;
let bosse: string;

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);

  const [tenant] = await db
    .insert(schema.transpaTenant)
    .values({ tenantId: "t-1", name: "Bolag 1" })
    .returning();

  const people = await db
    .insert(schema.employee)
    .values([
      { firstName: "Anders", lastName: "J", transpaId: "T-A", transpaTenantId: tenant.id },
      { firstName: "Bosse", lastName: "S", transpaId: "T-B", transpaTenantId: tenant.id },
      { firstName: "Ohämtad", lastName: "P" },
    ])
    .returning();
  [anders, bosse] = people.map((p) => p.id);

  process.env.TRANSPA_CLIENT_ID = "id";
  process.env.TRANSPA_CLIENT_SECRET = "hemlis";
});

afterAll(async () => closeDb(db));

const week = ["2026-08-17", "2026-08-21"] as const;

describe("fetchWeekShifts", () => {
  it("frågar en gång per person, för veckan", async () => {
    const { impl, calls } = fakeApi({ "T-A": [shift("s1", "2026-08-17")], "T-B": [] });
    const result = await fetchWeekShifts([anders, bosse], week[0], week[1], impl, db);

    expect(calls).toHaveLength(2);
    /* Ett dygns marginal i vardera riktningen: veckan frågas i svenska
       kalenderdagar men jämförs mot UTC, och natten till måndagen börjar
       före midnatt UTC. */
    for (const call of calls) {
      expect(call).toContain("startDateTimeAfter=2026-08-16");
      expect(call).toContain("startDateTimeBefore=2026-08-23");
    }
    expect(result.asked).toBe(2);
    expect(result.withShifts).toBe(1);
    expect(result.shifts).toBe(1);
  });

  it("räknar dem som saknar TransPA-koppling för sig", async () => {
    const { impl } = fakeApi({ "T-A": [] });
    const people = await db.select({ id: schema.employee.id }).from(schema.employee);
    const result = await fetchWeekShifts(people.map((p) => p.id), week[0], week[1], impl, db);

    expect(result.unlinked).toBe(1);
    expect(result.asked).toBe(2);
  });

  it("skriver passen så tavlan kan läsa dem", async () => {
    const { impl } = fakeApi({ "T-A": [shift("s1", "2026-08-17"), shift("s2", "2026-08-18")] });
    await fetchWeekShifts([anders], week[0], week[1], impl, db);

    const rows = await db.select().from(schema.transpaShift);
    expect(rows.map((r) => r.date).sort()).toEqual(["2026-08-17", "2026-08-18"]);
    expect(rows[0].employeeId).toBe(anders);
  });

  /* Ett pass som strukits i TransPA måste försvinna här också. En
     upsert kan ersätta men aldrig städa. */
  it("tar bort pass som inte längre finns i TransPA", async () => {
    const första = fakeApi({ "T-A": [shift("s1", "2026-08-17"), shift("s2", "2026-08-18")] });
    await fetchWeekShifts([anders], week[0], week[1], första.impl, db);

    const andra = fakeApi({ "T-A": [shift("s1", "2026-08-17")] });
    await fetchWeekShifts([anders], week[0], week[1], andra.impl, db);

    const rows = await db.select().from(schema.transpaShift);
    expect(rows.map((r) => r.transpaId)).toEqual(["s1"]);
  });

  it("rör inte pass utanför veckan som hämtas", async () => {
    const gammal = fakeApi({ "T-A": [shift("s9", "2026-09-15")] });
    await fetchWeekShifts([anders], "2026-09-14", "2026-09-18", gammal.impl, db);

    const ny = fakeApi({ "T-A": [shift("s1", "2026-08-17")] });
    await fetchWeekShifts([anders], week[0], week[1], ny.impl, db);

    const rows = await db.select().from(schema.transpaShift);
    expect(rows.map((r) => r.transpaId).sort()).toEqual(["s1", "s9"]);
  });

  /* En person som fallerar ska inte fälla veckan — och hens gamla pass
     ska stå kvar, eftersom vi inte vet att de är borta. */
  it("låter en persons fel stå för sig", async () => {
    const först = fakeApi({ "T-B": [shift("b1", "2026-08-17")] });
    await fetchWeekShifts([bosse], week[0], week[1], först.impl, db);

    const { impl } = fakeApi({ "T-A": [shift("s1", "2026-08-18")] }, ["T-B"]);
    const result = await fetchWeekShifts([anders, bosse], week[0], week[1], impl, db);

    expect(result.ok).toBe(true);
    expect(result.failed).toBe(1);
    expect(result.shifts).toBe(1);

    const rows = await db.select().from(schema.transpaShift);
    expect(rows.map((r) => r.transpaId).sort()).toEqual(["b1", "s1"]);
  });

  it("frågar ingenting när ingen efterfrågas", async () => {
    const { impl, calls } = fakeApi({});
    const result = await fetchWeekShifts([], week[0], week[1], impl, db);
    expect(calls).toEqual([]);
    expect(result.asked).toBe(0);
  });
});
