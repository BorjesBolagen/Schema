/**
 * Kör importen i minnet och rapporterar hur underlaget ser ut.
 *
 * Används för att kontrollera att tolkningen håller mot den skarpa
 * filen — och att konfliktvarningarna är få nog att betyda något.
 */
import { parseArgs } from "node:util";
import { and, gte, inArray, lte } from "drizzle-orm";
import { createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";
import { readSheet } from "./import/xlsx";
import { parsePersonallista } from "./import/personallista";
import { parseScheduleSheet } from "./import/parse-schema";
import { loadPeople, loadScheduleBoard } from "./import/load";
import {
  detectBookingConflicts,
  detectUnmanned,
  type AssignmentLike,
} from "../src/lib/conflicts";
import { isoWeek, weekDates } from "../src/lib/week";

const { values } = parseArgs({
  options: { file: { type: "string" }, from: { type: "string" }, to: { type: "string" } },
});
const file = values.file ?? process.env.SCHEMA_XLSX;
if (!file) {
  console.error("Ange källfilen: npx tsx scripts/verify-import.ts --file <Schema.xlsx>");
  process.exit(1);
}

const db = createDb("memory://");
await runMigrations(db);
const people = parsePersonallista(await readSheet(file, "Personallista"));
const blocks = parseScheduleSheet(await readSheet(file, "Schema NYBHLF"));
const { index } = await loadPeople(db, people);

const boards = [
  { name: "Dagschema", slug: "d", weekStartsOn: 1, visibleWeekdays: [1, 2, 3, 4, 5], pick: (b: (typeof blocks)[number]) => b.day.rows, importAbsences: false },
  { name: "Veckoschema", slug: "v", weekStartsOn: 0, visibleWeekdays: [0, 1, 2, 3, 4, 5], pick: (b: (typeof blocks)[number]) => b.far.rows, importAbsences: true },
];
for (const b of boards) {
  await loadScheduleBoard(db, { ...b, cellFields: ["driver"], blocks, index });
}

const allBoardsLater = await db.select().from(schema.board);
const boardName = new Map(allBoardsLater.map((b) => [b.id, b.name]));
const rows = await db.select().from(schema.boardRow);
const rowInfo = new Map(rows.map((r) => [r.id, r]));

const first = values.from ?? "2025-06-30";
const last = values.to ?? "2025-08-08";
const { year, week: firstWeek } = isoWeek(first);
const lastWeek = isoWeek(last).week;
const weekNumbers = Array.from({ length: lastWeek - firstWeek + 1 }, (_, i) => firstWeek + i);

/** Varje tavla visar sina egna dagar — obemannat räknas per tavla. */
const perBoard = allBoardsLater.map((b) => ({
  board: b,
  dates: weekNumbers.flatMap((w) => weekDates(year, w, b.weekStartsOn, b.visibleWeekdays)),
}));
const dates = [...new Set(perBoard.flatMap((p) => p.dates))].sort();

const raw = await db
  .select()
  .from(schema.assignment)
  .where(and(gte(schema.assignment.date, dates[0]), lte(schema.assignment.date, dates.at(-1)!)));

const assignments: AssignmentLike[] = raw.map((a) => {
  const row = rowInfo.get(a.boardRowId)!;
  return {
    id: a.id,
    boardRowId: a.boardRowId,
    date: a.date,
    slot: a.slot,
    employeeId: a.employeeId,
    vehicleId: a.vehicleId,
    boardId: row.boardId,
    boardName: boardName.get(row.boardId) ?? "?",
    rowLabel: row.sublabel ? `${row.label} ${row.sublabel}` : row.label,
  };
});

const absences = (await db.select().from(schema.absence)).map((x) => ({
  employeeId: x.employeeId,
  fromDate: x.fromDate,
  toDate: x.toDate,
  type: x.type as string,
}));

const conflicts = [
  ...detectBookingConflicts({ assignments, absences, dates }),
  ...detectUnmanned(
    perBoard.map((p) => ({
      rows: rows
        .filter((r) => r.boardId === p.board.id)
        .map((r) => ({ id: r.id, validFrom: r.validFrom, validTo: r.validTo })),
      dates: p.dates,
      assignments: assignments.filter((a) => a.boardId === p.board.id),
    })),
  ),
];

const byKind = conflicts.reduce<Record<string, number>>((acc, c) => {
  acc[c.kind] = (acc[c.kind] ?? 0) + 1;
  return acc;
}, {});

console.log(`\nPeriod ${dates[0]} – ${dates.at(-1)} (${dates.length} dagar)`);
console.log(`Tilldelningar: ${assignments.length}, varav med förare: ${assignments.filter((a) => a.employeeId).length}`);
console.log("\nKonflikter:");
for (const [kind, n] of Object.entries(byKind)) console.log(`  ${kind.padEnd(14)} ${n}`);

const employees = new Map((await db.select().from(schema.employee)).map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
console.log("\nExempel på dubbelbokningar:");
for (const c of conflicts.filter((x) => x.kind === "double-booked").slice(0, 8)) {
  console.log(`  ${c.date}  ${employees.get(c.employeeId)}  →  ${c.places.join("  |  ")}`);
}
console.log("\nExempel på inplanerad under frånvaro:");
for (const c of conflicts.filter((x) => x.kind === "absent").slice(0, 6)) {
  console.log(`  ${c.date}  ${employees.get(c.employeeId)}  (${c.absenceType})`);
}
