import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { getBoardWeek } from "./board-week";

/**
 * Tavelveckan hämtas med en enda handskriven SQL-fråga över ett tiotal
 * subselect:er. Den formen är snabb men den syns inte i typkontrollen:
 * ett komma för mycket, en kolumn som bytt namn eller en tabell som
 * tagits bort ger ett fel först när någon öppnar sidan. Det har hänt
 * två gånger, och båda gångerna gick det igenom `tsc` och `next build`
 * utan att någon test blev röd.
 *
 * Därför körs frågan här mot en riktig databas. Testet bryr sig inte om
 * detaljerna i vad som kommer ut — det som ska bevisas är att frågan
 * går att köra och att underlaget hittar hela vägen fram.
 */

let db: Db;
let linjeRow: string;

/** Symbolen getDb() slår upp i. Registrerad globalt, så den går att sätta här. */
const DB_KEY = Symbol.for("schema.db");

beforeAll(async () => {
  db = createDb("memory://");
  await runMigrations(db);
  (globalThis as Record<symbol, unknown>)[DB_KEY] = db;

  const [station] = await db.insert(schema.stationPlace).values({ name: "Nybro" }).returning();
  const [elin] = await db
    .insert(schema.employee)
    .values({ firstName: "Elin", lastName: "Karlsson", stationPlaceId: station.id })
    .returning();
  const [peter] = await db
    .insert(schema.employee)
    .values({ firstName: "Peter", lastName: "Mauritzson", stationPlaceId: station.id })
    .returning();
  const [bil] = await db.insert(schema.vehicle).values({ displayName: "BT08" }).returning();

  const [board] = await db
    .insert(schema.board)
    .values({ name: "Fjärr Nybro", slug: "fjarr-nybro", visibleShifts: ["day", "night"] })
    .returning();
  const [group] = await db
    .insert(schema.boardGroup)
    .values({ boardId: board.id, label: "STOCKHOLM", sortOrder: 0 })
    .returning();
  const [row] = await db
    .insert(schema.boardRow)
    .values({
      boardId: board.id,
      groupId: group.id,
      label: "BT08/09",
      sortOrder: 0,
      defaultVehicleId: bil.id,
    })
    .returning();

  await db.insert(schema.boardCrew).values([
    { boardId: board.id, employeeId: elin.id, sortOrder: 0 },
    { boardId: board.id, employeeId: peter.id, sortOrder: 1 },
  ]);
  await db.insert(schema.baseSchedule).values({
    boardId: board.id,
    boardRowId: row.id,
    employeeId: elin.id,
    shift: "day",
  });
  await db.insert(schema.assignment).values({
    boardRowId: row.id,
    date: "2026-08-17",
    shift: "day",
    slot: 0,
    employeeId: elin.id,
    source: "generated",
  });
  await db.insert(schema.absence).values({
    employeeId: peter.id,
    fromDate: "2026-08-19",
    toDate: "2026-08-20",
    type: "semester",
    status: "approved",
  });
  /* Arbetsdagarna kommer numera enbart härifrån. */
  await db.insert(schema.transpaShift).values({
    transpaId: "t1",
    employeeId: elin.id,
    date: "2026-08-17",
    shift: "day",
    startsAt: new Date("2026-08-17T04:00:00Z"),
    workMinutes: 540,
  });

  /* Linjebilen: två personer, samma natt, åt var sitt håll. Det är
     precis fallet som gjorde riktningen nödvändig. */
  const [linje] = await db
    .insert(schema.boardRow)
    .values({
      boardId: board.id,
      label: "BT17/23",
      sortOrder: 1,
      vehicleKind: "linjebil",
    })
    .returning();
  linjeRow = linje.id;

  for (const [i, [who, dir]] of (
    [
      [elin.id, "upp"],
      [peter.id, "ner"],
    ] as const
  ).entries()) {
    await db.insert(schema.transpaShift).values({
      transpaId: `natt-${i}`,
      employeeId: who,
      date: "2026-08-18",
      shift: "night",
      startsAt: new Date("2026-08-18T17:00:00Z"),
      direction: dir,
      name: `Vmo-Sto ${dir}`,
    });
    await db.insert(schema.assignment).values({
      boardRowId: linje.id,
      date: "2026-08-18",
      shift: "night",
      slot: i,
      employeeId: who,
      source: "generated",
    });
  }
});

afterAll(async () => {
  delete (globalThis as Record<symbol, unknown>)[DB_KEY];
  await closeDb(db);
});

describe("getBoardWeek", () => {
  it("kör samlingsfrågan och bygger veckan", async () => {
    const week = await getBoardWeek("fjarr-nybro", 2026, 34);

    expect(week).not.toBeNull();
    expect(week!.dates).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
    // Varje subselect ska ha kommit fram — det är det frågan mest kan gå sönder på.
    expect(week!.rows.map((r) => r.label)).toEqual(["BT08/09", "BT17/23"]);
    expect(week!.rows[0].groupLabel).toBe("STOCKHOLM");
    expect(week!.crew.map((c) => c.name).sort()).toEqual(["Elin Karlsson", "Peter Mauritzson"]);
    expect(week!.vehicles.map((v) => v.name)).toEqual(["BT08"]);
    expect(week!.groups.map((g) => g.label)).toEqual(["STOCKHOLM"]);
    expect(week!.baseSchedule).toHaveLength(1);
    // Stationsorten kommer ur sin egen subselect, via personalväljaren.
    expect(week!.pickerEmployees.map((e) => e.stationPlace)).toEqual(["Nybro", "Nybro"]);
  });

  it("ger null för en tavla som inte finns", async () => {
    expect(await getBoardWeek("finns-inte", 2026, 34)).toBeNull();
  });
});

/**
 * Riktningen på linjepassen.
 *
 * En linje körs av två bilar som möts på vägen: en upp och en ner
 * samma natt, på samma rad. Utan riktning går cellen inte att läsa —
 * och det blev synligt först när nattpassen började hamna rätt.
 */
describe("riktning i cellen", () => {
  it("bär riktningen från det hämtade passet till cellen", async () => {
    const week = await getBoardWeek("fjarr-nybro", 2026, 34);
    const rad = week!.rows.find((r) => r.id === linjeRow)!;
    const cellen = rad.cells["2026-08-18|night"];

    expect(cellen).toHaveLength(2);
    expect(cellen.map((c) => c.direction).sort()).toEqual(["ner", "upp"]);
  });

  it("visar radens biltyp, så vyn vet om riktningen ska ritas", async () => {
    const week = await getBoardWeek("fjarr-nybro", 2026, 34);
    expect(week!.rows.find((r) => r.id === linjeRow)!.vehicleKind).toBe("linjebil");
    // Raden som inte fått något val ska bete sig som förut.
    expect(week!.rows.find((r) => r.label === "BT08/09")!.vehicleKind).toBe("annan");
  });

  /* Ett pass utan riktning i benämningen ska ge null, inte en gissning. */
  it("ger null när det hämtade passet saknar riktning", async () => {
    const week = await getBoardWeek("fjarr-nybro", 2026, 34);
    const dagcellen = week!.rows.find((r) => r.label === "BT08/09")!.cells["2026-08-17|day"];
    expect(dagcellen[0].direction).toBeNull();
  });
});
