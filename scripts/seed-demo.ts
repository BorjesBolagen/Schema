/**
 * Demounderlag för utveckling.
 *
 * Inte kunddata — bara tillräckligt för att köra igenom flödet:
 * bemanning, bas-schema, arbetsmönster och "Fyll veckan". Skarp data
 * kommer från TransPA-synken.
 *
 *   npx tsx scripts/seed-demo.ts --db ./.pgdata
 */
import { parseArgs } from "node:util";
import { createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";
import { addDays, isoWeek, mondayOfWeek, toIso, weekDates } from "../src/lib/week";
import { getWorkDayProvider } from "../src/server/work-days";
import { planWeek } from "../src/server/fill-week";

const { values } = parseArgs({
  options: { db: { type: "string" } },
  // npm skickar med ett ensamt "--" när man kör `npm run seed -- …`.
  allowPositionals: true,
});
const db = createDb(values.db ?? process.env.PGLITE_DIR ?? "./.pgdata");
await runMigrations(db);

const stations = await db
  .insert(schema.stationPlace)
  .values([{ name: "Nybro" }, { name: "Hultsfred" }, { name: "Växjö" }, { name: "Gävle" }])
  .returning();
const station = Object.fromEntries(stations.map((s) => [s.name, s.id]));

const people = [
  ["Elin", "Karlsson", "Nybro"],
  ["Peter", "Mauritzson", "Nybro"],
  ["Björn", "Westman", "Nybro"],
  ["Roger", "Bergström", "Nybro"],
  ["Johan", "Olsson", "Nybro"],
  ["Max", "Kellgren", "Nybro"],
  ["Alma", "Persson", "Hultsfred"],
  ["Fredrik", "Axelsson", "Hultsfred"],
  ["Anna", "Hällblad", "Hultsfred"],
  ["Jerry", "Scherman", "Gävle"],
  ["Anders", "Håkansson", "Gävle"],
  ["Henrik", "Sundberg", "Växjö"],
] as const;

const employees = await db
  .insert(schema.employee)
  .values(
    people.map(([firstName, lastName, place], i) => ({
      firstName,
      lastName,
      employeeNumber: String(2000 + i),
      stationPlaceId: station[place],
    })),
  )
  .returning();
const byName = Object.fromEntries(employees.map((e) => [e.firstName, e]));

const vehicles = await db
  .insert(schema.vehicle)
  .values(
    ["BT08", "BT09", "BT13", "BT14", "BT24", "BT26", "HF03"].map((displayName) => ({
      displayName,
      externalId: displayName.replace(/\D/g, ""),
    })),
  )
  .returning();
const veh = Object.fromEntries(vehicles.map((v) => [v.displayName, v.id]));

const [board] = await db
  .insert(schema.board)
  .values({
    name: "Fjärr Nybro/Hultsfred",
    slug: "fjarr-nybro",
    weekStartsOn: 1,
    visibleWeekdays: [1, 2, 3, 4, 5],
    visibleShifts: ["day", "night"],
    cellFields: ["driver", "vehicle", "note"],
  })
  .returning();

const [gruppSthlm, gruppVsts] = await db
  .insert(schema.boardGroup)
  .values([
    { boardId: board.id, label: "Stockholm", sortOrder: 0 },
    { boardId: board.id, label: "Västerås", sortOrder: 1 },
  ])
  .returning();

const rows = await db
  .insert(schema.boardRow)
  .values([
    { boardId: board.id, groupId: gruppSthlm.id, label: "BT08/09", sublabel: "Stockholm", sortOrder: 0, defaultVehicleId: veh.BT08 },
    { boardId: board.id, groupId: gruppVsts.id, label: "BT13/14", sublabel: "Västerås", sortOrder: 1, defaultVehicleId: veh.BT13 },
    { boardId: board.id, groupId: gruppVsts.id, label: "BT24/26", sublabel: "Västerås", sortOrder: 2, defaultVehicleId: veh.BT24 },
    { boardId: board.id, label: "HF03", sublabel: "Hudiksvall", sortOrder: 3, defaultVehicleId: veh.HF03 },
  ])
  .returning();
const row = Object.fromEntries(rows.map((r) => [r.label, r.id]));

const crew = ["Elin", "Peter", "Björn", "Roger", "Johan", "Max", "Alma"];
await db
  .insert(schema.boardCrew)
  .values(crew.map((name, i) => ({ boardId: board.id, employeeId: byName[name].id, sortOrder: i })));

/* Bas-schemat: person ↔ bil. Inga dagar — de kommer från mönstren. */
const baseEntries = await db
  .insert(schema.baseSchedule)
  .values([
    { boardId: board.id, boardRowId: row["BT08/09"], employeeId: byName.Elin.id, shift: "day" },
    { boardId: board.id, boardRowId: row["BT08/09"], employeeId: byName.Peter.id, shift: "night" },
    { boardId: board.id, boardRowId: row["BT13/14"], employeeId: byName["Björn"].id, shift: "day" },
    { boardId: board.id, boardRowId: row["BT13/14"], employeeId: byName.Roger.id, shift: "day" },
    { boardId: board.id, boardRowId: row["BT24/26"], employeeId: byName.Johan.id, shift: "day" },
    { boardId: board.id, boardRowId: row.HF03, employeeId: byName.Alma.id, shift: "day" },
  ])
  .returning();

const anchor = mondayOfWeek(2026, 1);

/** [namn, cykelveckor, dagar per cykelvecka] */
const patterns: Array<[string, number, Array<[number, number[], "day" | "night"]>]> = [
  ["Elin", 1, [[0, [1, 2, 3, 4, 5], "day"]]],
  ["Peter", 1, [[0, [1, 2, 3, 4], "night"]]],
  // Björn kör måndag, tisdag, torsdag, fredag — Roger fyller onsdagen.
  ["Björn", 1, [[0, [1, 2, 4, 5], "day"]]],
  ["Roger", 1, [[0, [3], "day"]]],
  ["Johan", 1, [[0, [1, 2, 3, 4, 5], "day"]]],
  // Max jobbar men har ingen bil — hamnar i "Ej utlagda".
  ["Max", 1, [[0, [1, 2, 3, 4, 5], "day"]]],
  // Alma går ett rullande fyraveckorsschema.
  [
    "Alma",
    4,
    [
      [0, [1, 2, 3], "day"],
      [1, [4, 5], "day"],
      [2, [1, 3, 5], "night"],
      [3, [2, 4], "day"],
    ],
  ],
];

for (const [name, cycleWeeks, spec] of patterns) {
  const [pattern] = await db
    .insert(schema.workPattern)
    .values({ employeeId: byName[name].id, cycleWeeks, anchorDate: anchor })
    .returning();
  await db.insert(schema.workPatternDay).values(
    spec.flatMap(([cycleWeek, weekdays, shift]) =>
      weekdays.map((weekday) => ({ workPatternId: pattern.id, cycleWeek, weekday, shift })),
    ),
  );
}

/* Frånvaro spridd över året, så semestervyn har något att visa och
   bemanningsraden dippar under sommaren precis som i verkligheten. */
const week = (w: number, len = 1) => ({
  fromDate: mondayOfWeek(2026, w),
  toDate: addDays(mondayOfWeek(2026, w + len - 1), 6),
});

const absenceRows = await db
  .insert(schema.absence)
  .values([
    { employeeId: byName.Elin.id, ...week(28, 3), type: "semester", status: "approved" },
    { employeeId: byName["Björn"].id, ...week(29, 3), type: "semester", status: "approved" },
    { employeeId: byName.Roger.id, ...week(30, 2), type: "semester", status: "approved" },
    { employeeId: byName.Peter.id, ...week(29, 2), type: "semester", status: "approved" },
    { employeeId: byName.Alma.id, ...week(31, 3), type: "semester", status: "requested" },
    { employeeId: byName.Max.id, ...week(30, 3), type: "semester", status: "requested" },
    { employeeId: byName.Johan.id, ...week(12), type: "foraldraledig", status: "approved" },
    { employeeId: byName.Max.id, ...week(6), type: "sjuk", status: "approved" },
    { employeeId: byName.Roger.id, ...week(9), type: "vab", status: "approved" },
    // Den vecka som testas i veckovyn.
    { employeeId: byName.Johan.id, fromDate: "2026-08-20", toDate: "2026-08-21", type: "semester", status: "approved" },
  ])
  .returning();

/* Fyll veckorna runt idag, så appen visar ett bemannat schema direkt. */
const today = isoWeek(toIso(new Date()));
let filled = 0;
for (let i = -1; i <= 3; i++) {
  const week = today.week + i;
  if (week < 1 || week > 52) continue;
  const dates = weekDates(today.year, week, board.weekStartsOn, board.visibleWeekdays);
  const { workDays } = await getWorkDayProvider(db).getWorkDays(
    crew.map((n) => byName[n].id),
    dates[0],
    dates[dates.length - 1],
  );
  const plan = planWeek({
    workDays,
    baseSchedule: baseEntries,
    existing: [],
    absences: absenceRows.map((a) => ({
      employeeId: a.employeeId,
      fromDate: a.fromDate,
      toDate: a.toDate,
    })),
    dates,
  });
  if (plan.create.length) {
    await db
      .insert(schema.assignment)
      .values(plan.create.map((c) => ({ ...c, source: "generated" as const })));
    filled += plan.create.length;
  }
}

console.log(`Tavla: ${board.name}  →  /tavla/${board.slug}`);
console.log(`Veckoschema v.${today.week}      →  /tavla/${board.slug}?ar=${today.year}&vecka=${today.week}`);
console.log(`Semesterplanering       →  /tavla/${board.slug}/semester?ar=2026`);
console.log(`Personal: ${employees.length}, bemanning: ${crew.length}, rader: ${rows.length}`);
console.log(`Bas-schema, arbetsmönster och ${filled} utlagda pass inlagda.`);
