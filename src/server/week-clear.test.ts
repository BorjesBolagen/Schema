import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { clearWeekAssignments, weekClearFacts } from "./boards";

/**
 * Rensningen tar bort pass, och det går inte att ångra. Två saker måste
 * därför stämma exakt: att den träffar allt i veckan — även dagar
 * tavlan döljer — och att den inte träffar något utanför, varken en
 * annan vecka eller en annan tavla.
 *
 * Provas mot en riktig databas, eftersom avgränsningen sitter i
 * frågorna och inte i någon ren funktion.
 */

let db: Db;
let board: string;
let other: string;
let row: string;
let otherRow: string;
let anna: string;

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);

  const [a] = await db
    .insert(schema.employee)
    .values({ firstName: "Anna", lastName: "Andersson" })
    .returning();
  anna = a.id;

  const [b1] = await db
    .insert(schema.board)
    .values({ name: "Fjärr", slug: "fjarr", visibleShifts: ["day", "night"] })
    .returning();
  const [b2] = await db
    .insert(schema.board)
    .values({ name: "Lots", slug: "lots" })
    .returning();
  board = b1.id;
  other = b2.id;

  const [r1] = await db
    .insert(schema.boardRow)
    .values({ boardId: board, label: "BT08/09", sortOrder: 0 })
    .returning();
  const [r2] = await db
    .insert(schema.boardRow)
    .values({ boardId: other, label: "L1", sortOrder: 0 })
    .returning();
  row = r1.id;
  otherRow = r2.id;
});

afterAll(async () => {
  if (db) await closeDb(db);
});

/** Vecka 34 2026 är måndag 17 augusti till söndag 23 augusti. */
const VECKAN = { from: "2026-08-17", to: "2026-08-23" };

const pass = (
  boardRowId: string,
  date: string,
  source: "generated" | "manual" = "generated",
  slot = 0,
) => ({ boardRowId, date, shift: "day" as const, slot, employeeId: anna, source });

describe("weekClearFacts", () => {
  it("räknar veckans pass och hur många som är handpålagda", async () => {
    await db
      .insert(schema.assignment)
      .values([
        pass(row, "2026-08-17"),
        pass(row, "2026-08-18"),
        pass(row, "2026-08-19", "manual"),
      ]);

    const facts = await weekClearFacts(board, VECKAN.from, VECKAN.to, db);
    expect(facts.assignments).toBe(3);
    expect(facts.manual).toBe(1);
    expect(facts).toMatchObject(VECKAN);
  });

  it("räknar inte pass i en annan vecka", async () => {
    await db
      .insert(schema.assignment)
      .values([pass(row, "2026-08-17"), pass(row, "2026-08-24")]);

    expect((await weekClearFacts(board, VECKAN.from, VECKAN.to, db)).assignments).toBe(1);
  });

  it("räknar inte en annan tavlas pass", async () => {
    await db
      .insert(schema.assignment)
      .values([pass(row, "2026-08-17"), pass(otherRow, "2026-08-17")]);

    expect((await weekClearFacts(board, VECKAN.from, VECKAN.to, db)).assignments).toBe(1);
  });

  it("ger noll för en tom vecka", async () => {
    expect((await weekClearFacts(board, VECKAN.from, VECKAN.to, db)).assignments).toBe(0);
  });
});

describe("clearWeekAssignments", () => {
  it("tar bort veckans pass och lämnar grannveckorna", async () => {
    await db.insert(schema.assignment).values([
      pass(row, "2026-08-16"), // söndagen före
      pass(row, "2026-08-17"),
      pass(row, "2026-08-20"),
      pass(row, "2026-08-24"), // måndagen efter
    ]);

    expect(await clearWeekAssignments(board, VECKAN.from, VECKAN.to, db)).toBe(2);

    const kvar = await db.select({ date: schema.assignment.date }).from(schema.assignment);
    expect(kvar.map((a) => a.date).sort()).toEqual(["2026-08-16", "2026-08-24"]);
  });

  /* Det som motiverar att spannet är hela veckan och inte de synliga
     dagarna: lördagen syns inte på en mån–fre-tavla, men passet finns. */
  it("tar även pass på dagar tavlan döljer", async () => {
    await db
      .insert(schema.assignment)
      .values([pass(row, "2026-08-19"), pass(row, "2026-08-22")]);

    expect(await clearWeekAssignments(board, VECKAN.from, VECKAN.to, db)).toBe(2);
    expect(await db.select().from(schema.assignment)).toHaveLength(0);
  });

  it("tar både genererade och handpålagda pass", async () => {
    await db
      .insert(schema.assignment)
      .values([pass(row, "2026-08-17"), pass(row, "2026-08-17", "manual", 1)]);

    expect(await clearWeekAssignments(board, VECKAN.from, VECKAN.to, db)).toBe(2);
  });

  it("rör inte en annan tavla", async () => {
    await db
      .insert(schema.assignment)
      .values([pass(row, "2026-08-17"), pass(otherRow, "2026-08-17")]);

    await clearWeekAssignments(board, VECKAN.from, VECKAN.to, db);
    const kvar = await db
      .select({ boardRowId: schema.assignment.boardRowId })
      .from(schema.assignment);
    expect(kvar).toEqual([{ boardRowId: otherRow }]);
  });

  /* Poängen med rensningen är att kunna börja om, inte att börja från
     ingenting: underlaget för Fyll veckan måste överleva. */
  it("lämnar bemanning, bas-schema och hämtade pass i fred", async () => {
    await db.insert(schema.boardCrew).values({ boardId: board, employeeId: anna, sortOrder: 0 });
    await db
      .insert(schema.baseSchedule)
      .values({ boardId: board, boardRowId: row, employeeId: anna });
    await db.insert(schema.transpaShift).values({
      transpaId: "t1",
      employeeId: anna,
      date: "2026-08-17",
      shift: "day",
      startsAt: new Date("2026-08-17T04:00:00Z"),
    });
    await db.insert(schema.assignment).values([pass(row, "2026-08-17")]);

    await clearWeekAssignments(board, VECKAN.from, VECKAN.to, db);

    expect(await db.select().from(schema.boardCrew)).toHaveLength(1);
    expect(await db.select().from(schema.baseSchedule)).toHaveLength(1);
    expect(await db.select().from(schema.transpaShift)).toHaveLength(1);
  });

  it("klarar en tavla utan rader", async () => {
    const [tom] = await db
      .insert(schema.board)
      .values({ name: "Tom", slug: "tom" })
      .returning();
    expect(await clearWeekAssignments(tom.id, VECKAN.from, VECKAN.to, db)).toBe(0);
  });
});
