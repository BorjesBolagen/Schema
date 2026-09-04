import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { skrivOrdning } from "./sortering";

/**
 * Omordningen som en sats.
 *
 * Den skriver rå SQL med tabellnamnet interpolerat, alltså den sorts
 * kod som måste köras för att någon ska veta att den fungerar. Ett
 * felstavat kolumnnamn syns inte i typkontrollen.
 *
 * Prövas mot båda tabellerna den får röra, och på att den inte rör
 * rader som inte står i listan — en tavlas omordning får inte flytta om
 * en annans.
 */

let db: Db;

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);
});

afterAll(async () => {
  if (db) await closeDb(db);
});

async function tavlaMedRader(slug: string, etiketter: string[]) {
  const [b] = await db.insert(schema.board).values({ name: slug, slug }).returning();
  const rader = await db
    .insert(schema.boardRow)
    .values(etiketter.map((label, i) => ({ boardId: b.id, label, sortOrder: i })))
    .returning();
  return { board: b, rader };
}

const ordningen = async (boardId: string) =>
  (
    await db
      .select({ label: schema.boardRow.label })
      .from(schema.boardRow)
      .where(eq(schema.boardRow.boardId, boardId))
      .orderBy(asc(schema.boardRow.sortOrder))
  ).map((r) => r.label);

describe("skrivOrdning", () => {
  it("skriver om ordningen på tavlans rader", async () => {
    const { board, rader } = await tavlaMedRader("min", ["A", "B", "C"]);
    expect(await ordningen(board.id)).toEqual(["A", "B", "C"]);

    // C först, sedan A, sedan B.
    await skrivOrdning("board_row", [rader[2].id, rader[0].id, rader[1].id], db);
    expect(await ordningen(board.id)).toEqual(["C", "A", "B"]);
  });

  it("rör inte rader som inte står i listan", async () => {
    const min = await tavlaMedRader("min", ["A", "B"]);
    const annans = await tavlaMedRader("annans", ["X", "Y", "Z"]);

    await skrivOrdning("board_row", [min.rader[1].id, min.rader[0].id], db);
    expect(await ordningen(min.board.id)).toEqual(["B", "A"]);
    expect(await ordningen(annans.board.id)).toEqual(["X", "Y", "Z"]);
  });

  it("klarar bas-schemat också", async () => {
    const { board, rader } = await tavlaMedRader("min", ["A"]);
    const [e1] = await db
      .insert(schema.employee)
      .values({ firstName: "Alma", lastName: "P" })
      .returning();
    const [e2] = await db
      .insert(schema.employee)
      .values({ firstName: "Bo", lastName: "P" })
      .returning();
    const kopplingar = await db
      .insert(schema.baseSchedule)
      .values([
        { boardId: board.id, boardRowId: rader[0].id, employeeId: e1.id, sortOrder: 0 },
        { boardId: board.id, boardRowId: rader[0].id, employeeId: e2.id, sortOrder: 1 },
      ])
      .returning();

    await skrivOrdning("base_schedule", [kopplingar[1].id, kopplingar[0].id], db);
    const efter = await db
      .select({ id: schema.baseSchedule.id, sortOrder: schema.baseSchedule.sortOrder })
      .from(schema.baseSchedule)
      .orderBy(asc(schema.baseSchedule.sortOrder));
    expect(efter.map((r) => r.id)).toEqual([kopplingar[1].id, kopplingar[0].id]);
    expect(efter.map((r) => r.sortOrder)).toEqual([0, 1]);
  });

  it("gör ingenting på en tom lista", async () => {
    const { board } = await tavlaMedRader("min", ["A", "B"]);
    await skrivOrdning("board_row", [], db);
    expect(await ordningen(board.id)).toEqual(["A", "B"]);
  });

  /* Ordningen ska bli tät och börja på noll, inte ärva luckor från det
     som stod där förut — annars driver talen isär över tid. */
  it("numrerar om från noll utan luckor", async () => {
    const { board, rader } = await tavlaMedRader("min", ["A", "B", "C"]);
    await db
      .update(schema.boardRow)
      .set({ sortOrder: 500 })
      .where(eq(schema.boardRow.id, rader[0].id));

    await skrivOrdning("board_row", [rader[0].id, rader[1].id, rader[2].id], db);
    const tal = await db
      .select({ sortOrder: schema.boardRow.sortOrder })
      .from(schema.boardRow)
      .where(eq(schema.boardRow.boardId, board.id))
      .orderBy(asc(schema.boardRow.sortOrder));
    expect(tal.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });
});
