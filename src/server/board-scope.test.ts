import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  assignmentOnBoard,
  employeeOnBoard,
  groupOnBoard,
  rowOnBoard,
  rowsOnBoard,
} from "./board-scope";

/**
 * Att kontrollera samma sak som man skriver.
 *
 * Nitton server-actions tog emot både en slug och ett id från samma
 * klientanrop, kontrollerade behörigheten på slugen och skrev till id:t.
 * En planerare med tillgång till sin egen tavla kunde skicka sin slug
 * tillsammans med någon annans rad-, pass- eller tavel-id och skriva
 * där.
 *
 * Regeln står här, skriven en gång: id:t hämtas genom tavlan.
 */

let db: Db;
let min: string;
let annans: string;
let minRad: string;
let annansRad: string;
let minGrupp: string;
let annansGrupp: string;
let mittPass: string;
let annansPass: string;
let anna: string;
let bertil: string;

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

  const [b1] = await db.insert(schema.board).values({ name: "Min", slug: "min" }).returning();
  min = b1.id;
  const [b2] = await db
    .insert(schema.board)
    .values({ name: "Annans", slug: "annans" })
    .returning();
  annans = b2.id;

  const [g1] = await db
    .insert(schema.boardGroup)
    .values({ boardId: min, label: "Grupp", sortOrder: 0 })
    .returning();
  minGrupp = g1.id;
  const [g2] = await db
    .insert(schema.boardGroup)
    .values({ boardId: annans, label: "Grupp", sortOrder: 0 })
    .returning();
  annansGrupp = g2.id;

  const [r1] = await db
    .insert(schema.boardRow)
    .values({ boardId: min, label: "BT08", sortOrder: 0 })
    .returning();
  minRad = r1.id;
  const [r2] = await db
    .insert(schema.boardRow)
    .values({ boardId: annans, label: "BT99", sortOrder: 0 })
    .returning();
  annansRad = r2.id;

  const [p1] = await db
    .insert(schema.assignment)
    .values({ boardRowId: minRad, date: "2026-08-31", shift: "day", slot: 0, employeeId: anna })
    .returning();
  mittPass = p1.id;
  const [p2] = await db
    .insert(schema.assignment)
    .values({
      boardRowId: annansRad,
      date: "2026-08-31",
      shift: "day",
      slot: 0,
      employeeId: bertil,
    })
    .returning();
  annansPass = p2.id;

  await db.insert(schema.boardCrew).values({ boardId: min, employeeId: anna, sortOrder: 0 });
  await db.insert(schema.boardCrew).values({ boardId: annans, employeeId: bertil, sortOrder: 0 });
});

afterAll(async () => {
  if (db) await closeDb(db);
});

describe("rowOnBoard", () => {
  it("släpper igenom en rad på tavlan", async () => {
    expect(await rowOnBoard(min, minRad, db)).toBe(minRad);
  });

  it("stoppar en rad på någon annans tavla", async () => {
    await expect(rowOnBoard(min, annansRad, db)).rejects.toThrow(/hör inte till/);
  });

  /* Samma svar som för en främmande rad. Skillnaden vore i sig en
     upplysning om vad som finns. */
  it("stoppar ett id som inte finns", async () => {
    await expect(rowOnBoard(min, "00000000-0000-0000-0000-000000000000", db)).rejects.toThrow(
      /hör inte till/,
    );
  });
});

describe("rowsOnBoard", () => {
  it("släpper igenom tavlans egna rader", async () => {
    expect(await rowsOnBoard(min, [minRad], db)).toEqual([minRad]);
  });

  /* Ett främmande id mitt i en omordning skulle annars hinna flytta om
     halva tavlan innan det upptäcktes. */
  it("stoppar hela listan när ett id är främmande", async () => {
    await expect(rowsOnBoard(min, [minRad, annansRad], db)).rejects.toThrow(/hör inte till/);
  });

  it("godtar en tom lista utan att fråga databasen", async () => {
    expect(await rowsOnBoard(min, [], db)).toEqual([]);
  });
});

describe("assignmentOnBoard", () => {
  /* Passet bär ingen tavla själv — vägen dit går via raden, och det är
     just därför kontrollen var lätt att glömma. */
  it("släpper igenom ett pass på tavlans rad", async () => {
    expect(await assignmentOnBoard(min, mittPass, db)).toBe(mittPass);
  });

  it("stoppar ett pass på någon annans tavla", async () => {
    await expect(assignmentOnBoard(min, annansPass, db)).rejects.toThrow(/hör inte till/);
  });
});

describe("groupOnBoard", () => {
  it("släpper igenom tavlans egen grupp", async () => {
    expect(await groupOnBoard(min, minGrupp, db)).toBe(minGrupp);
  });

  it("stoppar en grupp på någon annans tavla", async () => {
    await expect(groupOnBoard(min, annansGrupp, db)).rejects.toThrow(/hör inte till/);
  });
});

describe("employeeOnBoard", () => {
  it("släpper igenom någon i bemanningen", async () => {
    expect(await employeeOnBoard(min, anna, db)).toBe(anna);
  });

  /* Frånvaro hör till personen, men den som bara har en tavla ska inte
     kunna sjukskriva vem som helst i bolaget. */
  it("stoppar någon som inte står på tavlan", async () => {
    await expect(employeeOnBoard(min, bertil, db)).rejects.toThrow(/hör inte till/);
  });
});
