import { parseArgs } from "node:util";
import { createDb } from "../../src/db/index";
import { runMigrations } from "../../src/db/migrate";
import { readSheet } from "./xlsx";
import { parsePersonallista } from "./personallista";
import { parseScheduleSheet } from "./parse-schema";
import { loadPeople, loadScheduleBoard } from "./load";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    db: { type: "string" },
    "personnel-sheet": { type: "string", default: "Personallista" },
    "schedule-sheet": { type: "string", default: "Schema NYBHLF" },
  },
});

const file = values.file ?? process.env.SCHEMA_XLSX;
if (!file) {
  console.error(
    "Ange källfilen: npm run import -- --file <sökväg till Schema.xlsx> [--db <postgres-url|katalog>]",
  );
  process.exit(1);
}

const db = createDb(values.db);
await runMigrations(db);

console.log(`Läser ${file}`);
const people = parsePersonallista(await readSheet(file, values["personnel-sheet"]!));
const blocks = parseScheduleSheet(await readSheet(file, values["schedule-sheet"]!));

const { inserted, index, ambiguous } = await loadPeople(db, people);
console.log(`\nPersonal: ${inserted} av ${people.length} rader importerade`);
console.log(`Tvetydiga smeknamn (kopplas manuellt): ${ambiguous.size}`);

const dagschema = await loadScheduleBoard(db, {
  name: "Fjärr Nybro/Hultsfred — dagschema",
  slug: "fjarr-nybro-dagschema",
  visibleWeekdays: [1, 2, 3, 4, 5],
  weekStartsOn: 1,
  cellFields: ["driver", "vehicle", "note"],
  blocks,
  pick: (b) => b.day.rows,
  index,
  importAbsences: false,
});

const veckoschema = await loadScheduleBoard(db, {
  name: "Fjärr Nybro/Hultsfred — veckoschema",
  slug: "fjarr-nybro-veckoschema",
  visibleWeekdays: [0, 1, 2, 3, 4, 5],
  weekStartsOn: 0,
  cellFields: ["driver", "vehicle", "note"],
  blocks,
  pick: (b) => b.far.rows,
  index,
  importAbsences: true,
});

const report = (name: string, s: Awaited<ReturnType<typeof loadScheduleBoard>>) => {
  const pct = s.assignments ? ((s.resolved / s.assignments) * 100).toFixed(1) : "0";
  console.log(`\n${name}`);
  console.log(`  rader            ${s.rows}`);
  console.log(`  celler           ${s.assignments}`);
  console.log(`  kopplade förare  ${s.resolved} (${pct} %)`);
  console.log(`  noteringar       ${s.notes}`);
  console.log(`  till granskning  ${s.unresolved} distinkta namn`);
  if (s.absences) console.log(`  frånvaro         ${s.absences}`);
};

report("Dagschema", dagschema);
report("Veckoschema", veckoschema);

const weeks = blocks.length;
const unparsed = blocks.reduce((n, b) => n + b.unparsedAbsenceText.length, 0);
const mismatch = blocks.filter((b) => b.dateMismatches > 0);
console.log(`\nVeckoblock: ${weeks}. Otydd text i semesterrutan: ${unparsed} (lämnas till granskning).`);
if (mismatch.length) {
  console.log(
    `\nVARNING: ${mismatch.length} veckoblock har datumceller som inte stämmer med` +
      ` veckonumret. Datumen har räknats ur vecka och veckodag i stället.`,
  );
  console.log(
    `  Berörda veckor: ${mismatch.slice(0, 12).map((b) => `${b.year} v.${b.week}`).join(", ")}` +
      (mismatch.length > 12 ? ` … (+${mismatch.length - 12})` : ""),
  );
}
