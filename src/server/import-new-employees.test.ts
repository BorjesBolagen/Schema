import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { importNewEmployees } from "./transpa-sync";

/**
 * Knappen under Grunddata får bara lägga till. Det som ska bevisas är
 * att den som redan finns lämnas orörd, att avslutade inte tas in, och
 * att den som lagts upp för hand kopplas ihop i stället för att dubbleras.
 */
let db: Db;
let stationId: string;

function fakeApi(employees: unknown[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("connect/token")) {
      return new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }),
      );
    }
    return new Response(JSON.stringify({ items: employees, cursor: {} }));
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);

  const [tenant] = await db
    .insert(schema.transpaTenant)
    .values({ tenantId: "t-1", name: "Bolag 1" })
    .returning();
  const [station] = await db.insert(schema.stationPlace).values({ name: "Borås" }).returning();
  stationId = station.id;

  await db.insert(schema.employee).values([
    // Finns redan från TransPA, men med ett namn appen inte ska röra här.
    { firstName: "Anders", lastName: "Gammal", transpaId: "T-A", transpaTenantId: tenant.id, employeeNumber: "1" },
    // Upplagd för hand innan hen fanns i TransPA.
    { firstName: "Cilla", lastName: "Berg", employeeNumber: "3", stationPlaceId: stationId },
  ]);

  process.env.TRANSPA_CLIENT_ID = "id";
  process.env.TRANSPA_CLIENT_SECRET = "hemlis";
});

afterAll(async () => closeDb(db));

const api = fakeApi([
  { id: "T-A", firstName: "Anders", lastName: "Nytt", employeeNumber: 1, isActive: true },
  { id: "T-B", firstName: "Bosse", lastName: "Sund", employeeNumber: 2, professionGroup: "driver" },
  { id: "T-C", firstName: "Cilla", lastName: "Berg", employeeNumber: 3 },
  { id: "T-D", firstName: "Dennis", lastName: "Slutat", employeeNumber: 4, isActive: false },
]);

describe("importNewEmployees", () => {
  it("lägger bara upp dem som saknas", async () => {
    const result = await importNewEmployees(api, db);
    expect(result.ok).toBe(true);
    expect(result.added.map((p) => p.name)).toEqual(["Bosse Sund"]);

    const [bosse] = await db.select().from(schema.employee).where(eq(schema.employee.transpaId, "T-B"));
    expect(bosse.professionGroup).toBe("driver");
    expect(bosse.transpaTenantId).not.toBeNull();
  });

  it("rör inte den som redan finns", async () => {
    await importNewEmployees(api, db);
    const [anders] = await db.select().from(schema.employee).where(eq(schema.employee.transpaId, "T-A"));
    expect(anders.lastName).toBe("Gammal");
  });

  it("tar inte in den som slutat", async () => {
    await importNewEmployees(api, db);
    const rows = await db.select().from(schema.employee).where(eq(schema.employee.transpaId, "T-D"));
    expect(rows).toEqual([]);
  });

  it("kopplar ihop den handupplagda i stället för att dubblera", async () => {
    const result = await importNewEmployees(api, db);
    expect(result.linked.map((p) => p.name)).toEqual(["Cilla Berg"]);

    const cillas = await db.select().from(schema.employee).where(eq(schema.employee.firstName, "Cilla"));
    expect(cillas).toHaveLength(1);
    expect(cillas[0].transpaId).toBe("T-C");
    expect(cillas[0].stationPlaceId).toBe(stationId);
  });

  it("hittar inget nytt andra gången", async () => {
    await importNewEmployees(api, db);
    const again = await importNewEmployees(api, db);
    expect(again.added).toEqual([]);
    expect(again.linked).toEqual([]);
  });

  it("säger ifrån utan TransPA-uppgifter", async () => {
    delete process.env.TRANSPA_CLIENT_ID;
    const result = await importNewEmployees(api, db);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/TransPA-uppgifter/);
  });
});
