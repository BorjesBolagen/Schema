/**
 * Mäter serversidan mot mätunderlaget.
 *
 * Utan webbläsaren i vägen: det som mäts här är databasen och den kod
 * som formar svaret, inte React. Det som är långsamt här blir aldrig
 * snabbt i webbläsaren.
 *
 * PGlite är märkbart långsammare än Postgres, så absoluta tal säger
 * ingenting om drift. Det som säger något är förhållandena — vilken
 * fråga som tar hälften av tiden, och vad som växer med bolaget i
 * stället för med tavlan man tittar på.
 *
 * Körs genom vitest, inte tsx — modulerna är märkta server-only, och
 * det är vitest-uppsättningen som sätter de villkor Next sätter.
 *
 *   npx tsx scripts/seed-stort.ts --db ./.pgdata-stort
 *   PGLITE_DIR=./.pgdata-stort npx vitest run --config vitest.bench.config.ts
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { it } from "vitest";
import { getDb, schema } from "../src/db/index";
import { isoWeek, toIso } from "../src/lib/week";
import { getBoardWeek } from "../src/server/board-week";
import { getVacationYear } from "../src/server/vacation-year";
import { boardOverviews } from "../src/server/board-overview";
import { listEmployees, listStations, listVehicles } from "../src/server/basedata";
import { addDays, weekSpan } from "../src/lib/week";
import { getWorkDayProvider } from "../src/server/work-days";

const nu = isoWeek(toIso(new Date()));

async function mät(namn: string, körning: () => Promise<unknown>, varv = 5) {
  await körning(); // uppvärmning — första anropet betalar för planerna
  const tider: number[] = [];
  for (let i = 0; i < varv; i++) {
    const t = performance.now();
    await körning();
    tider.push(performance.now() - t);
  }
  tider.sort((a, b) => a - b);
  const median = tider[Math.floor(tider.length / 2)];
  console.log(`${namn.padEnd(38)} ${median.toFixed(0).padStart(6)} ms   (${tider[0].toFixed(0)}–${tider.at(-1)!.toFixed(0)})`);
  return median;
}

it("mäter serversidan", { timeout: 600_000 }, async () => {
  const db = getDb();
  const tavlor = await db.select().from(schema.board);
  const slug = tavlor[0].slug;

  console.log(`Underlag: ${tavlor.length} tavlor, vecka ${nu.week} ${nu.year}\n`);

  await mät("getBoardWeek (veckovyn)", () => getBoardWeek(slug, nu.year, nu.week));
  await mät("getVacationYear (semestervyn)", () => getVacationYear(slug, nu.year), 3);
  await mät("boardOverviews (startsidan)", () => boardOverviews(tavlor, nu.year, nu.week));
  await mät("listEmployees (grunddata)", () => listEmployees());
  await mät("listVehicles (grunddata)", () => listVehicles());
  await mät("listStations (grunddata)", () => listStations());

  /* Var i getBoardWeek tiden ligger. Samlingsfrågan körs ordagrant som
     den står i board-week.ts — texten läses ur källfilen så mätningen
     inte tyst mäter en gammal kopia. */
  const board = tavlor[0];
  const { from: first, to: last } = weekSpan(nu.year, nu.week, board.weekStartsOn);
  const källa = readFileSync("src/server/board-week.ts", "utf8");
  const rå = källa.slice(källa.indexOf("await db.execute(sql`") + "await db.execute(sql`".length);
  const bundleSql = rå
    .slice(0, rå.indexOf("`),"))
    .replaceAll("${board.id}", `'${board.id}'`)
    .replaceAll("${first}", `'${first}'`)
    .replaceAll("${last}", `'${last}'`)
    .replaceAll("${addDays(first, -1)}", `'${addDays(first, -1)}'`)
    .replaceAll("${addDays(last, 1)}", `'${addDays(last, 1)}'`);

  console.log("");
  await mät("  · samlingsfrågan ensam (SQL)", () => db.execute(sql.raw(bundleSql)));

  const crew = await db
    .select({ employeeId: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id));
  const crewIds = crew.map((c) => c.employeeId);
  const provider = getWorkDayProvider();
  await mät("  · arbetsdagarna (provider)", () => provider.getWorkDays(crewIds, first, last));

  /* Hur mycket veckovyn faktiskt bär hem, och hur mycket av det som hör
     till tavlan man tittar på. */
  const data = await getBoardWeek(slug, nu.year, nu.week);
  if (data) {
    const storlek = (v: unknown) => (JSON.stringify(v).length / 1024).toFixed(0) + " kB";
    console.log("\nVad veckovyn bär hem:");
    console.log(`  hela svaret                    ${storlek(data)}`);
    console.log(`  varav rader på tavlan          ${data.rows.length}`);
    console.log(`  varav personer i bemanningen   ${data.crew.length}`);
    console.log(`  hela personalregistret (väljaren)${data.pickerEmployees.length}`);
    console.log("\n  Vad svaret består av:");
    for (const [namn, del] of [
      ["pickerEmployees", data.pickerEmployees],
      ["rows (rutnätet)", data.rows],
      ["personRows", data.personRows],
      ["crew", data.crew],
      ["conflicts", data.conflicts],
      ["vehicles", data.vehicles],
      ["baseSchedule", data.baseSchedule],
    ] as const) {
      console.log(`    ${namn.padEnd(18)} ${storlek(del).padStart(7)}`);
    }
  }

});
