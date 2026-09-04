/**
 * Demounderlag för utveckling.
 *
 * Inte kunddata — bara tillräckligt för att köra igenom flödet:
 * bemanning, bas-schema, pass och "Fyll veckan". Skarp data
 * kommer från TransPA-synken.
 *
 *   npx tsx scripts/seed-demo.ts --db ./.pgdata
 */
import { parseArgs } from "node:util";
import { count } from "drizzle-orm";
import { closeDb, createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";
import { addDays, isoWeek, mondayOfWeek, toIso, weekDates } from "../src/lib/week";
import { hashPassword } from "../src/lib/password";
import { parseDirection } from "../src/lib/transpa/direction";
import { getWorkDayProvider } from "../src/server/work-days";
import { planWeek } from "../src/server/fill-week";

const { values } = parseArgs({
  options: { db: { type: "string" } },
  // npm skickar med ett ensamt "--" när man kör `npm run seed -- …`.
  allowPositionals: true,
});
/* Ordningen spelar roll: --db vinner, sedan DATABASE_URL, sedan den
   lokala katalogen. Utan DATABASE_URL i kedjan skulle skriptet tyst
   skriva till .pgdata trots att man pekat ut en riktig databas. */
const db = createDb(values.db ?? process.env.DATABASE_URL ?? process.env.PGLITE_DIR ?? "./.pgdata");
await runMigrations(db);

/* Demounderlaget läggs bara i en tom databas. Att köra om det mot en
   databas som redan används skulle antingen krascha på en unik nyckel
   eller dubblera tavlorna. */
const existing = await db.select({ n: count() }).from(schema.employee);
if ((existing[0]?.n ?? 0) > 0) {
  console.error(
    "Databasen innehåller redan personal — demounderlaget läggs bara i en tom databas.\n" +
      "Töm tabellerna först, eller peka DATABASE_URL på en tom databas.",
  );
  await closeDb(db);
  process.exit(1);
}

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.se";
/* Demolösenordet måste själv klara appens krav — tolv tecken. Det gamla
   var tio, alltså kortare än vad appen tillåter, och kontot gick därför
   inte att byta lösenord på genom sitt eget formulär. */
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "schema-demo-2026";
const [admin] = await db
  .insert(schema.appUser)
  .values({
    email: adminEmail,
    name: "Administratör",
    role: "admin",
    passwordHash: await hashPassword(adminPassword),
  })
  .onConflictDoNothing({ target: schema.appUser.email })
  .returning();

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
      // Som hos Börjes: nästan alla kör, ett par gör något annat.
      professionGroup: i === 10 ? "garage" : i === 11 ? "other" : "driver",
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
    // Linjebil: två personer möts på vägen, en upp och en ner samma natt.
    { boardId: board.id, groupId: gruppSthlm.id, label: "BT08/09", sublabel: "Stockholm", sortOrder: 0, defaultVehicleId: veh.BT08, vehicleKind: "linjebil" as const },
    { boardId: board.id, groupId: gruppVsts.id, label: "BT13/14", sublabel: "Västerås", sortOrder: 1, defaultVehicleId: veh.BT13 },
    { boardId: board.id, groupId: gruppVsts.id, label: "BT24/26", sublabel: "Västerås", sortOrder: 2, defaultVehicleId: veh.BT24 },
    { boardId: board.id, label: "HF03", sublabel: "Hudiksvall", sortOrder: 3, defaultVehicleId: veh.HF03 },
  ])
  .returning();
const row = Object.fromEntries(rows.map((r) => [r.label, r.id]));

const crew = ["Elin", "Peter", "Henrik", "Björn", "Roger", "Johan", "Max", "Alma"];
await db
  .insert(schema.boardCrew)
  .values(crew.map((name, i) => ({ boardId: board.id, employeeId: byName[name].id, sortOrder: i })));

/* Bas-schemat: person ↔ bil. Inga dagar och inget skift — dagarna
   kommer från arbetsdagarna och skiftet ur passets tider. */
const baseEntries = await db
  .insert(schema.baseSchedule)
  .values([
    { boardId: board.id, boardRowId: row["BT08/09"], employeeId: byName.Elin.id },
    /* Linjebilen körs av två som möts på vägen: Peter går upp de nätter
       Henrik går ner, och tvärtom nästa natt. */
    { boardId: board.id, boardRowId: row["BT08/09"], employeeId: byName.Peter.id },
    { boardId: board.id, boardRowId: row["BT08/09"], employeeId: byName.Henrik.id },
    { boardId: board.id, boardRowId: row["BT13/14"], employeeId: byName["Björn"].id },
    { boardId: board.id, boardRowId: row["BT13/14"], employeeId: byName.Roger.id },
    { boardId: board.id, boardRowId: row["BT24/26"], employeeId: byName.Johan.id },
    { boardId: board.id, boardRowId: row.HF03, employeeId: byName.Alma.id },
  ])
  .returning();

const today = isoWeek(toIso(new Date()));

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
    /* En frånvaro i den vecka demot öppnar på, så förstasidans
       frånvarosiffra och tavlans varningar har något att visa.

       Henrik och ingen annan: han är den ende i bemanningen som inget
       e2e-skript hänger på. Först stod Roger här, och då föll
       e2e-kopplabort — det kontrollerar att hans utlagda pass överlever
       en bortkoppling, och med frånvaron lade Fyll veckan aldrig ut
       några. Ett rött som inte betydde att något var trasigt. */
    { employeeId: byName.Henrik.id, ...week(today.week), type: "vab", status: "approved" },
  ])
  .returning();

/* Ett synkkvitto, så förstasidan kan visa när grunddata senast hämtades.
   Utan raden går den grenen aldrig att se i demot. */
await db.insert(schema.syncRun).values({
  resource: "employees",
  status: "ok",
  itemCount: 12,
  finishedAt: new Date(Date.now() - 26 * 3600 * 1000),
});

/* Fyll veckorna runt idag, så appen visar ett bemannat schema direkt. */
let filled = 0;
/**
 * Pass, som om de kommit från TransPA.
 *
 * Arbetsmönstren är borttagna — TransPA är källan till arbetsdagar — så
 * demot behöver riktiga pass att lägga ut. Formen är den TransPA
 * faktiskt skickar: en starttidpunkt och en längd, inget slutdatum.
 */
const demoShifts: Array<[string, number[], number, number]> = [
  // [namn, veckodagar, starttimme svensk tid, timmar]
  ["Elin", [1, 2, 3, 4, 5], 6, 9],
  // Linjebilens två: samma nätter, åt var sitt håll.
  ["Peter", [1, 2, 3, 4], 22, 9],
  ["Henrik", [1, 2, 3, 4], 22, 9],
  // Björn kör måndag, tisdag, torsdag, fredag — Roger fyller onsdagen.
  ["Björn", [1, 2, 4, 5], 6, 10],
  ["Roger", [3], 6, 10],
  ["Johan", [1, 2, 3, 4, 5], 7, 9],
  // Max jobbar men har ingen bil — hamnar i "Ej utlagda".
  ["Max", [1, 2, 3, 4, 5], 6, 8],
  ["Alma", [4, 5], 6, 9],
  ["Fredrik", [1, 2, 3, 4, 5], 6, 8],
];

/* Sommartid är UTC+2. Demot ligger i augusti, så en fast timme räcker —
   omräkningen som gäller på riktigt sitter i localParts. */
const utcHour = (localHour: number) => (localHour - 2 + 24) % 24;

for (let i = -1; i <= 3; i++) {
  const week = today.week + i;
  if (week < 1 || week > 52) continue;
  const dates = weekDates(today.year, week, board.weekStartsOn, board.visibleWeekdays);

  const rows = demoShifts.flatMap(([name, weekdays, startHour, hours]) =>
    dates
      .filter((d) => weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()))
      .map((date) => {
        /* Linjebilens folk växlar riktning varannan natt, precis som på
           riktigt. Benämningen är den enda källan — riktningen tolkas ur
           den med samma funktion som hämtningen använder, så demot inte
           kan visa något hämtningen inte skulle ha gett. */
        const udda = new Date(`${date}T00:00:00Z`).getUTCDay() % 2 === 1;
        const riktning =
          name === "Peter" ? (udda ? "upp" : "ner") : name === "Henrik" ? (udda ? "ner" : "upp") : null;
        const benämning = riktning ? `Vmo-Sto ${riktning}` : "Demo";

        return {
          transpaId: `demo-${name}-${date}`,
          employeeId: byName[name].id,
          date,
          shift: (startHour >= 17 || startHour < 4 ? "night" : "day") as "day" | "night",
          startsAt: new Date(`${date}T${String(utcHour(startHour)).padStart(2, "0")}:00:00Z`),
          workMinutes: hours * 60,
          isExtraShift: false,
          name: benämning,
          direction: parseDirection(benämning),
        };
      }),
  );
  if (rows.length) await db.insert(schema.transpaShift).values(rows).onConflictDoNothing();
}

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

/**
 * Ett läskonto.
 *
 * board_member.role fick betydelse i säkerhetsomgången, men rollen går
 * inte att sätta någonstans i gränssnittet — alla medlemmar skrivs in
 * som editor. Utan ett läskonto i underlaget finns det alltså ingen väg
 * att pröva den halvan alls, och en spärr ingen kört är en spärr man
 * hoppas på.
 */
const viewerEmail = process.env.SEED_VIEWER_EMAIL ?? "lasare@example.se";
const viewerPassword = process.env.SEED_VIEWER_PASSWORD ?? "schema-demo-2026";
const [viewer] = await db
  .insert(schema.appUser)
  .values({
    email: viewerEmail,
    name: "Läsare",
    role: "planner",
    passwordHash: await hashPassword(viewerPassword),
  })
  .onConflictDoNothing({ target: schema.appUser.email })
  .returning();
if (viewer) {
  await db
    .insert(schema.boardMember)
    .values({ boardId: board.id, userId: viewer.id, role: "viewer" })
    .onConflictDoNothing();
}

/**
 * Ett planerarkonto med ändringsrätt.
 *
 * Det är den vanligaste användaren appen har — en trafikansvarig som
 * bygger och justerar sin egen tavla — och den enda roll som inte fanns
 * i underlaget. Utan den provades hela appen som administratör, och
 * administratören går förbi varje medlemskontroll.
 */
const plannerEmail = process.env.SEED_PLANNER_EMAIL ?? "planerare@example.se";
const plannerPassword = process.env.SEED_PLANNER_PASSWORD ?? "schema-demo-2026";
const [planner] = await db
  .insert(schema.appUser)
  .values({
    email: plannerEmail,
    name: "Planerare",
    role: "planner",
    passwordHash: await hashPassword(plannerPassword),
  })
  .onConflictDoNothing({ target: schema.appUser.email })
  .returning();
if (planner) {
  await db
    .insert(schema.boardMember)
    .values({ boardId: board.id, userId: planner.id, role: "editor" })
    .onConflictDoNothing();
}

if (admin) console.log(`Inloggning: ${adminEmail} / ${adminPassword}`);
if (planner) console.log(`Planerare: ${plannerEmail} / ${plannerPassword}`);
if (viewer) console.log(`Läsbehörighet: ${viewerEmail} / ${viewerPassword}`);
console.log(`Tavla: ${board.name}  →  /tavla/${board.slug}`);
console.log(`Veckoschema v.${today.week}      →  /tavla/${board.slug}?ar=${today.year}&vecka=${today.week}`);
console.log(`Semesterplanering       →  /tavla/${board.slug}/semester?ar=2026`);
console.log(`Personal: ${employees.length}, bemanning: ${crew.length}, rader: ${rows.length}`);
console.log(`Bas-schema, pass och ${filled} utlagda pass inlagda.`);

await closeDb(db);
