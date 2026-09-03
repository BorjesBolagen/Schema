import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { boardOverviews, lastSync } from "./board-overview";

/**
 * Frågan är handskriven SQL och körs mot en riktig databas här.
 *
 * Skälet står i board-week.test.ts: ett kommatecken fel i en sådan
 * sträng passerar både tsc och next build och faller först när någon
 * öppnar sidan. En typkontroll ser inte in i strängen.
 */

let db: Db;
let anna: string;
let bertil: string;
let mandag: string;
let sondag: string;

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);

  const [a] = await db
    .insert(schema.employee)
    .values({ firstName: "Anna", lastName: "Ek" })
    .returning();
  anna = a.id;
  const [b] = await db
    .insert(schema.employee)
    .values({ firstName: "Bertil", lastName: "Ask" })
    .returning();
  bertil = b.id;

  /* Två tavlor med olika veckostart, för det är just det som gör att en
     enda fråga inte kan använda ett gemensamt spann. */
  const [m] = await db
    .insert(schema.board)
    .values({ name: "Måndagstavlan", slug: "mandag", weekStartsOn: 1 })
    .returning();
  mandag = m.id;
  const [s] = await db
    .insert(schema.board)
    .values({ name: "Söndagstavlan", slug: "sondag", weekStartsOn: 0 })
    .returning();
  sondag = s.id;
});

afterAll(async () => {
  if (db) await closeDb(db);
});

const veckan = () => boardOverviews(
  [
    { id: mandag, weekStartsOn: 1 },
    { id: sondag, weekStartsOn: 0 },
  ],
  2026,
  36,
  db,
);

describe("boardOverviews", () => {
  it("ger noll för en tom tavla i stället för att utelämna den", async () => {
    const ut = await veckan();
    expect(ut.get(mandag)).toEqual({
      boardId: mandag,
      crew: 0,
      rows: 0,
      assignments: 0,
      absent: 0,
    });
  });

  it("räknar bemanning och rader", async () => {
    await db.insert(schema.boardCrew).values([
      { boardId: mandag, employeeId: anna, sortOrder: 0 },
      { boardId: mandag, employeeId: bertil, sortOrder: 1 },
    ]);
    await db.insert(schema.boardRow).values({ boardId: mandag, label: "BT08", sortOrder: 0 });

    const ut = (await veckan()).get(mandag)!;
    expect(ut.crew).toBe(2);
    expect(ut.rows).toBe(1);
  });

  it("räknar bara veckans pass", async () => {
    const [row] = await db
      .insert(schema.boardRow)
      .values({ boardId: mandag, label: "BT08", sortOrder: 0 })
      .returning();
    await db.insert(schema.assignment).values([
      // v.36 2026 är 31 aug–6 sep.
      { boardRowId: row.id, date: "2026-08-31", shift: "day", slot: 0, employeeId: anna },
      { boardRowId: row.id, date: "2026-09-04", shift: "day", slot: 0, employeeId: anna },
      // Veckan efter — ska inte räknas.
      { boardRowId: row.id, date: "2026-09-08", shift: "day", slot: 0, employeeId: anna },
    ]);

    expect((await veckan()).get(mandag)!.assignments).toBe(2);
  });

  /* Söndagstavlan börjar dagen före måndagstavlan. Ett pass på den
     söndagen hör till v.36 där men till v.35 på måndagstavlan — och det
     är hela skälet till att spannen räknas per tavla. */
  it("använder varje tavlas eget veckospann", async () => {
    const [rM] = await db
      .insert(schema.boardRow)
      .values({ boardId: mandag, label: "M", sortOrder: 0 })
      .returning();
    const [rS] = await db
      .insert(schema.boardRow)
      .values({ boardId: sondag, label: "S", sortOrder: 0 })
      .returning();
    // Söndagen 30 aug 2026 — före måndagstavlans v.36.
    await db.insert(schema.assignment).values([
      { boardRowId: rM.id, date: "2026-08-30", shift: "day", slot: 0, employeeId: anna },
      { boardRowId: rS.id, date: "2026-08-30", shift: "day", slot: 0, employeeId: anna },
    ]);

    const ut = await veckan();
    expect(ut.get(mandag)!.assignments).toBe(0);
    expect(ut.get(sondag)!.assignments).toBe(1);
  });

  it("räknar frånvarande i bemanningen, en gång per person", async () => {
    await db.insert(schema.boardCrew).values([
      { boardId: mandag, employeeId: anna, sortOrder: 0 },
      { boardId: mandag, employeeId: bertil, sortOrder: 1 },
    ]);
    await db.insert(schema.absence).values([
      // Två frånvaroperioder för samma person under veckan.
      { employeeId: anna, fromDate: "2026-08-31", toDate: "2026-09-01", type: "semester" },
      { employeeId: anna, fromDate: "2026-09-03", toDate: "2026-09-04", type: "vab" },
      // Bertil är borta veckan efter.
      { employeeId: bertil, fromDate: "2026-09-14", toDate: "2026-09-18", type: "semester" },
    ]);

    expect((await veckan()).get(mandag)!.absent).toBe(1);
  });

  /* En frånvaro som börjar före veckan och slutar inne i den räknas. */
  it("räknar frånvaro som överlappar veckan", async () => {
    await db.insert(schema.boardCrew).values({ boardId: mandag, employeeId: anna, sortOrder: 0 });
    await db
      .insert(schema.absence)
      .values({ employeeId: anna, fromDate: "2026-08-24", toDate: "2026-09-01", type: "semester" });

    expect((await veckan()).get(mandag)!.absent).toBe(1);
  });

  it("räknar inte frånvaro för någon utanför bemanningen", async () => {
    await db
      .insert(schema.absence)
      .values({ employeeId: anna, fromDate: "2026-08-31", toDate: "2026-09-04", type: "semester" });

    expect((await veckan()).get(mandag)!.absent).toBe(0);
  });

  it("ger en tom karta utan tavlor, utan att fråga databasen", async () => {
    expect(await boardOverviews([], 2026, 36, db)).toEqual(new Map());
  });
});

describe("lastSync", () => {
  it("ger null när ingen synk körts", async () => {
    expect(await lastSync(db)).toBeNull();
  });

  it("ger den senaste lyckade körningen", async () => {
    await db.insert(schema.syncRun).values([
      { resource: "employees", status: "ok", finishedAt: new Date("2026-09-01T10:00:00Z") },
      { resource: "shifts", status: "ok", finishedAt: new Date("2026-09-02T10:00:00Z") },
      /* En misslyckad körning är inte ett kvitto på att uppgifterna är
         färska — den ska inte kunna se ut som det. */
      { resource: "shifts", status: "failed", finishedAt: new Date("2026-09-03T10:00:00Z") },
    ]);

    expect((await lastSync(db))?.toISOString()).toBe("2026-09-02T10:00:00.000Z");
  });
});
