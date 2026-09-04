import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { getBoardWeek } from "./board-week";
import { isoWeek, mondayOfWeek, toIso } from "@/lib/week";

/**
 * Konflikterna en tavla rapporterar ska vara tavlans egna.
 *
 * detectBookingConflicts får hela bolagets pass för veckan, och det ska
 * den ha: en förare bokad på både fjärr- och lotstavlan syns bara om
 * båda ligger på bordet. Men resultatet gick tillbaka orört, så
 * rubriken på en tavla räknade upp krockar som helt hörde hemma på en
 * annan. "3 dubbelbokningar" på en tavla med sex rader kunde vara noll
 * här och tre någon annanstans, och den som gick för att leta hittade
 * ingenting.
 *
 * Två sidor prövas, för filtret får inte lösa problemet genom att kasta
 * bort det som är själva poängen: krocken mellan två tavlor ska synas
 * på båda.
 */

let db: Db;
const DB_KEY = Symbol.for("schema.db");

const nu = isoWeek(toIso(new Date()));
const måndag = mondayOfWeek(nu.year, nu.week);

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);
  (globalThis as Record<symbol, unknown>)[DB_KEY] = db;
});

afterAll(async () => {
  if (db) await closeDb(db);
});

/** En tavla med en rad, och personerna i bemanningen. */
async function tavla(namn: string, slug: string, personer: string[]) {
  const [b] = await db.insert(schema.board).values({ name: namn, slug }).returning();
  const [rad] = await db
    .insert(schema.boardRow)
    .values({ boardId: b.id, label: `${slug}-rad`, sortOrder: 0 })
    .returning();
  if (personer.length) {
    await db
      .insert(schema.boardCrew)
      .values(personer.map((employeeId, i) => ({ boardId: b.id, employeeId, sortOrder: i })));
  }
  return { board: b, rad };
}

async function person(förnamn: string) {
  const [e] = await db
    .insert(schema.employee)
    .values({ firstName: förnamn, lastName: "Persson" })
    .returning();
  return e;
}

const dubbelbokningar = async (slug: string) =>
  (await getBoardWeek(slug, nu.year, nu.week))!.conflicts.filter(
    (c) => c.kind === "double-booked",
  );

describe("konflikter avgränsas till tavlan", () => {
  it("rapporterar inte en dubbelbokning som ligger helt på en annan tavla", async () => {
    const alma = await person("Alma");
    const bo = await person("Bo");
    const min = await tavla("Min", "min", [alma.id]);
    const annans = await tavla("Annans", "annans", [bo.id]);

    // Alma står en gång på min tavla — inget fel.
    await db.insert(schema.assignment).values({
      boardRowId: min.rad.id,
      date: måndag,
      shift: "day",
      slot: 0,
      employeeId: alma.id,
    });
    // Bo är dubbelbokad, men bara på den andra tavlan.
    const annansRad2 = await db
      .insert(schema.boardRow)
      .values({ boardId: annans.board.id, label: "annans-rad-2", sortOrder: 1 })
      .returning();
    await db.insert(schema.assignment).values([
      { boardRowId: annans.rad.id, date: måndag, shift: "day", slot: 0, employeeId: bo.id },
      { boardRowId: annansRad2[0].id, date: måndag, shift: "day", slot: 0, employeeId: bo.id },
    ]);

    expect(await dubbelbokningar("min")).toHaveLength(0);
    // …men den finns, och syns där den hör hemma.
    expect(await dubbelbokningar("annans")).toHaveLength(1);
  });

  /* Det filtret inte får göra: tysta krocken mellan två tavlor. Den är
     hela skälet till att hela bolagets pass läses in. */
  it("visar en dubbelbokning som korsar två tavlor på båda", async () => {
    const alma = await person("Alma");
    const min = await tavla("Min", "min", [alma.id]);
    const annans = await tavla("Annans", "annans", [alma.id]);

    await db.insert(schema.assignment).values([
      { boardRowId: min.rad.id, date: måndag, shift: "day", slot: 0, employeeId: alma.id },
      { boardRowId: annans.rad.id, date: måndag, shift: "day", slot: 0, employeeId: alma.id },
    ]);

    const här = await dubbelbokningar("min");
    const där = await dubbelbokningar("annans");
    expect(här).toHaveLength(1);
    expect(där).toHaveLength(1);
    // Och den nämner var personen står — annars går den inte att lösa.
    expect(här[0].kind === "double-booked" && här[0].places.join(" ")).toContain("Annans");
  });

  it("rapporterar inte frånvarokrockar från en annan tavla", async () => {
    const alma = await person("Alma");
    const bo = await person("Bo");
    const min = await tavla("Min", "min", [alma.id]);
    const annans = await tavla("Annans", "annans", [bo.id]);

    await db.insert(schema.absence).values({
      employeeId: bo.id,
      fromDate: måndag,
      toDate: måndag,
      type: "semester",
    });
    await db.insert(schema.assignment).values([
      { boardRowId: min.rad.id, date: måndag, shift: "day", slot: 0, employeeId: alma.id },
      { boardRowId: annans.rad.id, date: måndag, shift: "day", slot: 0, employeeId: bo.id },
    ]);

    const minVecka = await getBoardWeek("min", nu.year, nu.week);
    const annansVecka = await getBoardWeek("annans", nu.year, nu.week);
    expect(minVecka!.conflicts.filter((c) => c.kind === "absent")).toHaveLength(0);
    expect(annansVecka!.conflicts.filter((c) => c.kind === "absent")).toHaveLength(1);
  });

  /* Obemannade rader räknades redan per tavla. Med här för att filtret
     inte ska råka ta dem med sig. */
  it("behåller de obemannade raderna på den egna tavlan", async () => {
    const alma = await person("Alma");
    await tavla("Min", "min", [alma.id]);
    const vecka = await getBoardWeek("min", nu.year, nu.week);
    expect(vecka!.conflicts.filter((c) => c.kind === "unmanned").length).toBeGreaterThan(0);
  });
});
