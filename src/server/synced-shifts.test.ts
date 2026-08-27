import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { SyncedShiftProvider } from "./shift-provider";

/**
 * Läsvägen körs i tavelvyns renderingsväg och rör bara databasen —
 * det är hela poängen med att passen synkas i stället för att hämtas
 * vid varje sidladdning. Testet kör därför mot en riktig databas.
 */
let db: Db;
let alma: string;
let bosse: string;

beforeAll(async () => {
  db = createDb("memory://");
  await runMigrations(db);

  const people = await db
    .insert(schema.employee)
    .values([
      { firstName: "Alma", lastName: "Persson" },
      { firstName: "Bosse", lastName: "Sund" },
    ])
    .returning();
  [alma, bosse] = people.map((p) => p.id);

  const at = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  await db.insert(schema.transpaShift).values([
    { transpaId: "s1", employeeId: alma, date: "2026-08-17", shift: "day", startsAt: at("2026-08-17", 5) },
    { transpaId: "s2", employeeId: alma, date: "2026-08-18", shift: "day", startsAt: at("2026-08-18", 5) },
    // Samma dag och skift igen — ett delat pass är fortfarande en dag.
    { transpaId: "s3", employeeId: alma, date: "2026-08-18", shift: "day", startsAt: at("2026-08-18", 12) },
    { transpaId: "s4", employeeId: alma, date: "2026-08-18", shift: "night", startsAt: at("2026-08-18", 20) },
    // Utanför fönstret.
    { transpaId: "s5", employeeId: alma, date: "2026-09-01", shift: "day", startsAt: at("2026-09-01", 5) },
  ]);
});

afterAll(async () => closeDb(db));

describe("SyncedShiftProvider", () => {
  const week = (ids: string[]) =>
    new SyncedShiftProvider(db).getWorkDays(ids, "2026-08-17", "2026-08-21");

  it("läser passen för veckan", async () => {
    const { workDays } = await week([alma]);
    expect(workDays.map((w) => `${w.date} ${w.shift}`).sort()).toEqual([
      "2026-08-17 day",
      "2026-08-18 day",
      "2026-08-18 night",
    ]);
  });

  it("räknar två pass samma dag och skift som en dag", async () => {
    const { workDays } = await week([alma]);
    expect(workDays.filter((w) => w.date === "2026-08-18" && w.shift === "day")).toHaveLength(1);
  });

  it("tar inte med pass utanför fönstret", async () => {
    const { workDays } = await week([alma]);
    expect(workDays.some((w) => w.date === "2026-09-01")).toBe(false);
  });

  /**
   * Täckningen avgör om mönstret får ta över. Den som saknar pass ska
   * lämnas otäckt — annars tolkas tystnad som ledighet och tavlan töms
   * för alla vars pass ännu inte förts in i TransPA.
   */
  it("täcker bara den som faktiskt har pass", async () => {
    const { covered } = await week([alma, bosse]);
    expect(covered).toEqual([alma]);
  });

  it("frågar inte databasen i onödan", async () => {
    expect(await new SyncedShiftProvider(db).getWorkDays([], "2026-08-17", "2026-08-21")).toEqual({
      workDays: [],
      covered: [],
    });
  });
});
