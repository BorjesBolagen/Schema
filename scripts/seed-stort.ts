/**
 * Underlag i verklig storlek, för att mäta.
 *
 * Demot har tolv personer och en tavla. Med det ser allt snabbt ut,
 * också det som växer med hela bolaget i stället för med den tavla man
 * tittar på — och det är just den sortens kostnad man vill hitta innan
 * kunden gör det.
 *
 * Siffrorna är satta efter Börjes ungefärliga storlek: några hundra i
 * personalregistret, en tavla per trafikansvarig, och pass hämtade från
 * TransPA för alla under en tid framåt.
 *
 * Bara mätunderlag. Inga konton, inga riktiga namn.
 *
 *   npx tsx scripts/seed-stort.ts --db ./.pgdata-stort
 */
import { parseArgs } from "node:util";
import { count } from "drizzle-orm";
import { closeDb, createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";
import { addDays, isoWeek, mondayOfWeek, toIso } from "../src/lib/week";
import { hashPassword } from "../src/lib/password";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    personal: { type: "string" },
    tavlor: { type: "string" },
    veckor: { type: "string" },
  },
  allowPositionals: true,
});

const ANTAL_PERSONAL = Number(values.personal ?? 400);
const ANTAL_TAVLOR = Number(values.tavlor ?? 25);
const RADER_PER_TAVLA = 6;
const ANTAL_VECKOR = Number(values.veckor ?? 12);

const db = createDb(values.db ?? process.env.PGLITE_DIR ?? "./.pgdata-stort");
await runMigrations(db);

const fanns = await db.select({ n: count() }).from(schema.employee);
if ((fanns[0]?.n ?? 0) > 0) {
  console.error("Databasen är inte tom. Mätunderlaget läggs bara i en tom databas.");
  await closeDb(db);
  process.exit(1);
}

const t0 = Date.now();

/* ---- Stationsorter och fordon ---- */
const orter = await db
  .insert(schema.stationPlace)
  .values(["Nybro", "Hultsfred", "Växjö", "Gävle", "Värnamo", "Hudiksvall"].map((name) => ({ name })))
  .returning();

const fordon = await db
  .insert(schema.vehicle)
  .values(
    Array.from({ length: ANTAL_TAVLOR * RADER_PER_TAVLA }, (_, i) => ({
      displayName: `BT${String(i + 1).padStart(3, "0")}`,
      stationPlaceId: orter[i % orter.length].id,
    })),
  )
  .returning();

/* ---- Personal ---- */
const personal = await db
  .insert(schema.employee)
  .values(
    Array.from({ length: ANTAL_PERSONAL }, (_, i) => ({
      firstName: `Förnamn${i}`,
      lastName: `Efternamn${i}`,
      employeeNumber: String(2000 + i),
      stationPlaceId: orter[i % orter.length].id,
      professionGroup: i % 9 === 0 ? "garage" : "driver",
    })),
  )
  .returning();

/* ---- Konto ---- */
const [admin] = await db
  .insert(schema.appUser)
  .values({
    email: "admin@example.se",
    name: "Administratör",
    role: "admin",
    passwordHash: await hashPassword("schema-demo-2026"),
  })
  .returning();

/* ---- Tavlor med rader, bemanning och bas-schema ---- */
const tavlor = await db
  .insert(schema.board)
  .values(
    Array.from({ length: ANTAL_TAVLOR }, (_, i) => ({
      name: `Tavla ${i + 1}`,
      slug: `tavla-${i + 1}`,
      ownerId: admin.id,
      sortOrder: i,
    })),
  )
  .returning();

const allaRader: (typeof schema.boardRow.$inferSelect)[] = [];
for (const [i, tavla] of tavlor.entries()) {
  const rader = await db
    .insert(schema.boardRow)
    .values(
      Array.from({ length: RADER_PER_TAVLA }, (_, j) => ({
        boardId: tavla.id,
        label: fordon[i * RADER_PER_TAVLA + j].displayName,
        sublabel: orter[j % orter.length].name,
        defaultVehicleId: fordon[i * RADER_PER_TAVLA + j].id,
        sortOrder: j,
      })),
    )
    .returning();
  allaRader.push(...rader);

  /* Bemanningen: personalen delas mellan tavlorna, tolv per tavla, med
     lite överlapp så konfliktdetekteringen har något att göra. */
  const bemanning = Array.from({ length: 12 }, (_, k) => personal[(i * 10 + k) % personal.length]);
  await db
    .insert(schema.boardCrew)
    .values(
      bemanning.map((e, k) => ({ boardId: tavla.id, employeeId: e.id, sortOrder: k })),
    )
    .onConflictDoNothing();

  await db.insert(schema.baseSchedule).values(
    bemanning.map((e, k) => ({
      boardId: tavla.id,
      boardRowId: rader[k % rader.length].id,
      employeeId: e.id,
      sortOrder: k,
    })),
  );
}

/* ---- Hämtade pass för alla, ANTAL_VECKOR veckor framåt ---- */
const nu = isoWeek(toIso(new Date()));
const start = mondayOfWeek(nu.year, nu.week);

const passRader: (typeof schema.transpaShift.$inferInsert)[] = [];
for (let d = 0; d < ANTAL_VECKOR * 7; d++) {
  const datum = addDays(start, d);
  const veckodag = d % 7;
  if (veckodag > 4) continue; // helg
  for (const [i, e] of personal.entries()) {
    if ((i + d) % 5 === 0) continue; // ledig var femte dag
    const natt = i % 4 === 0;
    passRader.push({
      transpaId: `${e.id}-${datum}`,
      employeeId: e.id,
      date: datum,
      shift: natt ? "night" : "day",
      startsAt: new Date(`${datum}T${natt ? "21:00" : "06:00"}:00Z`),
      endsAt: new Date(`${natt ? addDays(datum, 1) : datum}T${natt ? "05:00" : "15:00"}:00Z`),
      workMinutes: 480,
      name: i % 3 === 0 ? "Nybro–Stockholm" : "Stockholm–Nybro",
    });
  }
}
for (let i = 0; i < passRader.length; i += 2000) {
  await db.insert(schema.transpaShift).values(passRader.slice(i, i + 2000)).onConflictDoNothing();
}

/* ---- Utlagda pass ---- */
const passIndex = new Map<string, (typeof passRader)[number]>();
for (const p of passRader) passIndex.set(`${p.employeeId}|${p.date}`, p);

const utlagda: (typeof schema.assignment.$inferInsert)[] = [];
for (const [i, tavla] of tavlor.entries()) {
  const rader = allaRader.filter((r) => r.boardId === tavla.id);
  const bemanning = Array.from({ length: 12 }, (_, k) => personal[(i * 10 + k) % personal.length]);
  for (let d = 0; d < ANTAL_VECKOR * 7; d++) {
    const datum = addDays(start, d);
    if (d % 7 > 4) continue;
    for (const [k, e] of bemanning.entries()) {
      const pass = passIndex.get(`${e.id}|${datum}`);
      if (!pass) continue;
      utlagda.push({
        boardRowId: rader[k % rader.length].id,
        date: datum,
        shift: pass.shift as "day" | "night",
        slot: Math.floor(k / rader.length),
        employeeId: e.id,
        source: "generated" as const,
      });
    }
  }
}
for (let i = 0; i < utlagda.length; i += 2000) {
  await db.insert(schema.assignment).values(utlagda.slice(i, i + 2000)).onConflictDoNothing();
}

/* ---- Frånvaro: var tionde person en vecka någonstans ---- */
await db.insert(schema.absence).values(
  personal
    .filter((_, i) => i % 10 === 0)
    .map((e, i) => {
      const från = addDays(start, (i % ANTAL_VECKOR) * 7);
      return { employeeId: e.id, fromDate: från, toDate: addDays(från, 6), type: "semester" as const };
    }),
);

const rader = {
  personal: personal.length,
  fordon: fordon.length,
  tavlor: tavlor.length,
  boardRader: allaRader.length,
  hämtadePass: passRader.length,
  utlagdaPass: utlagda.length,
};
console.log(`Klart på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.table(rader);
console.log("Inloggning: admin@example.se / schema-demo-2026");
console.log("Tavla: /tavla/tavla-1");

await closeDb(db);
