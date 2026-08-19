import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "../../src/db/index";
import { runMigrations } from "../../src/db/migrate";
import { deriveRows, loadPeople, loadScheduleBoard } from "./load";
import type { ScheduleRow, WeekBlock } from "./parse-schema";
import type { PersonRecord } from "./personallista";

function person(over: Partial<PersonRecord> & Pick<PersonRecord, "firstName" | "lastName">): PersonRecord {
  return {
    displayAlias: null,
    signature: null,
    employeeNumber: null,
    email: null,
    phone: null,
    supervisor: null,
    stationPlaceText: null,
    trafficAreaText: null,
    vacationGroup: null,
    workGroup: null,
    isActive: true,
    ...over,
  };
}

function row(label: string, sublabel: string | null, cells: Array<[string, string]>): ScheduleRow {
  return { label, sublabel, slot: 0, cells: cells.map(([date, text]) => ({ date, text })) };
}

function block(week: number, day: ScheduleRow[], far: ScheduleRow[] = []): WeekBlock {
  return {
    week,
    year: 2025,
    headerRow: 0,
    dateMismatches: 0,
    day: { dates: ["2025-06-30", "2025-07-01"], rows: day },
    far: { dates: ["2025-06-29"], rows: far },
    absences: [],
    unparsedAbsenceText: [],
  };
}

describe("deriveRows", () => {
  it("använder etiketten ensam när den är unik i veckan", () => {
    const rows = deriveRows([block(27, [row("BT08/09", "Stockholm", [])])], (b) => b.day.rows);
    expect(rows).toEqual([{ key: "BT08/09", label: "BT08/09", sublabel: "Stockholm", sortOrder: 0 }]);
  });

  it("tar med underetiketten när etiketten upprepas — 'Dahl' står på fyra rader", () => {
    const rows = deriveRows(
      [block(27, [row("Dahl", "4010", []), row("Dahl", "4030", []), row("BT12", "Blekinge", [])])],
      (b) => b.day.rows,
    );
    expect(rows.map((r) => r.key)).toEqual(["Dahl|4010", "Dahl|4030", "BT12"]);
  });

  it("väljer den vanligaste underetiketten när den varierar mellan veckor", () => {
    const rows = deriveRows(
      [
        block(27, [row("BT17/23", "Stockholm", [])]),
        block(28, [row("BT17/23", "Stockholm", [])]),
        block(29, [row("BT17/23", "Sthlm extra", [])]),
      ],
      (b) => b.day.rows,
    );
    expect(rows[0].sublabel).toBe("Stockholm");
  });
});

describe("import mot databas", () => {
  let db: Db;
  let stats: Awaited<ReturnType<typeof loadScheduleBoard>>;

  beforeAll(async () => {
    db = createDb("memory://");
    await runMigrations(db);

    const { index } = await loadPeople(db, [
      person({ firstName: "Elin", lastName: "Karlsson", employeeNumber: "1001" }),
      person({ firstName: "Albin", lastName: "Lundberg", employeeNumber: "1002" }),
      person({ firstName: "BAHAA ALDIN", lastName: "SBAHI", employeeNumber: "1003" }),
      // Två Anders gör förnamnet tvetydigt.
      person({ firstName: "Anders", lastName: "Håkansson", employeeNumber: "1004" }),
      person({ firstName: "Anders", lastName: "Nilsson", employeeNumber: "1005" }),
    ]);

    stats = await loadScheduleBoard(db, {
      name: "Test",
      slug: "test",
      visibleWeekdays: [1, 2],
      weekStartsOn: 1,
      cellFields: ["driver"],
      blocks: [
        block(27, [
          row("BT08/09", "Stockholm", [
            ["2025-06-30", "Elin K"],
            ["2025-07-01", "Albin L Sjuk"],
          ]),
          row("BT27", "Multi", [["2025-06-30", "Elin K/Albin L"]]),
          row("HF13", "Extrabil", [
            ["2025-06-30", "###"],
            ["2025-07-01", "Anders"],
          ]),
        ]),
      ],
      pick: (b) => b.day.rows,
      index,
      importAbsences: false,
    });
  });

  it("skapar en rad per tur", () => {
    expect(stats.rows).toBe(3);
  });

  it("kopplar smeknamn till person och behåller resten som notering", async () => {
    const rows = await db
      .select()
      .from(schema.assignment)
      .where(eq(schema.assignment.date, "2025-07-01"));
    const withNote = rows.find((r) => r.note === "Sjuk");
    expect(withNote?.employeeId).toBeTruthy();
  });

  it("lägger delad tur på två slots i samma cell", async () => {
    const [bt27] = await db.select().from(schema.boardRow).where(eq(schema.boardRow.label, "BT27"));
    const cells = await db
      .select()
      .from(schema.assignment)
      .where(eq(schema.assignment.boardRowId, bt27.id));
    expect(cells.map((c) => c.slot).sort()).toEqual([0, 1]);
    expect(cells.every((c) => c.employeeId)).toBe(true);
  });

  it("behåller ### som notering utan förare", async () => {
    const rows = await db
      .select()
      .from(schema.assignment)
      .where(eq(schema.assignment.note, "###"));
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBeNull();
  });

  it("gissar inte på tvetydiga namn utan listar dem för granskning", async () => {
    const pending = await db.select().from(schema.unresolvedAlias);
    expect(pending.map((p) => p.alias)).toContain("Anders");
  });
});
