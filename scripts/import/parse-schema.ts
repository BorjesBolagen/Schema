import { isoWeek, mondayOfWeek, addDays as addIsoDays } from "../../src/lib/week";
import { type Grid, isoDate, text } from "./xlsx";

/* Kolumnindex (nollbaserade) i bladet "Schema NYBHLF". */
const DAY_LABEL = 0; // A
const DAY_SUBLABEL = 1; // B
const DAY_FIRST_HEADER = 2; // C — första veckodagskolumnen
const FAR_LABEL = 8; // I

const WEEK_HEADER = /^Vecka\s*:?\s*(\d+)$/i;

/**
 * Semesterrutan är olika rubricerad i olika veckor — "Semester",
 * "Semester/Lediga", "Lediga/Semester". Bara 14 av 82 veckoblock har
 * någon rubrik alls.
 */
const ABSENCE_HEADING = /semester|lediga/i;

/** Årtalsrader ("2025", "2025/2026") delar av bladet och är inte turer. */
const YEAR_SEPARATOR = /^\d{4}(\s*\/\s*\d{4})?$/;

const WEEKDAY_NAMES: Record<string, number> = {
  söndag: 0, sondag: 0,
  måndag: 1, mandag: 1,
  tisdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lördag: 6, lordag: 6,
};

export interface ScheduleCell {
  date: string;
  /** Rå celltext. Namn löses upp senare, noteringar behålls som de är. */
  text: string;
}

export interface ScheduleRow {
  label: string;
  sublabel: string | null;
  /** >0 när raden fortsätter föregående rad, t.ex. den prickade raden under BT08/09. */
  slot: number;
  cells: ScheduleCell[];
}

export interface SubBoard {
  dates: string[];
  rows: ScheduleRow[];
}

export interface AbsenceEntry {
  /** Rå text ur semesterrutan, t.ex. "Alex S hela veckan". */
  raw: string;
  alias: string;
  fromDate: string;
  toDate: string;
}

export interface WeekBlock {
  week: number;
  year: number;
  headerRow: number;
  /** Vänsterblocket: rader = bil/linje, veckodagarna enligt rubrikraden. */
  day: SubBoard;
  /** Högerblocket: rader = bil/linje, inleds med helgen före måndagen. */
  far: SubBoard;
  /** Poster ur semesterrutan som gick att tyda entydigt. */
  absences: AbsenceEntry[];
  /** Text ur semesterrutan som inte gick att tyda — går till granskning. */
  unparsedAbsenceText: string[];
  /** Datumceller i bladet som inte stämmer med veckonummer och veckodag. */
  dateMismatches: number;
}

/**
 * Datumet för en veckodag i en given ISO-vecka.
 *
 * Fjärrblocket inleder veckan med helgen *före* måndagen, så lördag och
 * söndag ligger före veckans måndag, inte efter.
 */
export function dateForWeekday(year: number, week: number, weekday: number): string {
  const monday = mondayOfWeek(year, week);
  const offset = weekday === 0 ? -1 : weekday === 6 ? -2 : weekday - 1;
  return addIsoDays(monday, offset);
}

/** Läser veckodagsrubrikerna från och med en kolumn, tills en okänd cell. */
function readWeekdayHeader(
  grid: Grid,
  row: number,
  firstCol: number,
): Array<{ col: number; weekday: number }> {
  const out: Array<{ col: number; weekday: number }> = [];
  for (let c = firstCol; c < firstCol + 10; c++) {
    const wd = WEEKDAY_NAMES[text(grid, row, c).toLowerCase()];
    if (wd === undefined) {
      if (out.length) break;
      continue;
    }
    out.push({ col: c, weekday: wd });
  }
  return out;
}

const WEEKDAY_ABBR: Record<string, number> = {
  sön: 0, son: 0, sö: 0,
  mån: 1, man: 1, må: 1, ma: 1,
  tis: 2, ti: 2,
  ons: 3, on: 3,
  tors: 4, tor: 4, to: 4,
  fre: 5, fr: 5,
  lör: 6, lor: 6, lö: 6,
};

function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * Tyder en rad i semesterrutan.
 *
 * Rutan är fritext och kolumnläget betyder ingenting — samma ruta
 * innehåller ibland listor över *tillgänglig* personal. Därför tolkas
 * bara de två formuleringar som är entydiga: "<namn> hela veckan" och
 * "<namn> <veckodag>". Allt annat lämnas till granskning hellre än att
 * någon felaktigt markeras som ledig.
 */
export function parseAbsenceText(raw: string, weekDates: string[]): AbsenceEntry | null {
  const s = raw.trim();
  if (!s || weekDates.length === 0) return null;

  const whole = s.match(/^(.+?)\s+hela\s+veckan\.?$/i);
  if (whole) {
    return {
      raw: s,
      alias: whole[1].trim(),
      fromDate: weekDates[0],
      toDate: weekDates[weekDates.length - 1],
    };
  }

  const day = s.match(/^(.+?)\s+([A-Za-zÅÄÖåäö]{2,4})\.?$/);
  if (day) {
    const wd = WEEKDAY_ABBR[day[2].toLowerCase()];
    if (wd !== undefined) {
      const hit = weekDates.find((d) => weekdayOfIso(d) === wd);
      if (hit) return { raw: s, alias: day[1].trim(), fromDate: hit, toDate: hit };
    }
  }

  return null;
}

interface SubBoardOpts {
  labelCol: number;
  subLabelCol?: number;
  columns: Array<{ col: number; date: string }>;
  startRow: number;
  endRow: number;
  isStopLabel?: (label: string) => boolean;
}

function readSubBoard(grid: Grid, opts: SubBoardOpts): { board: SubBoard; stoppedAtRow: number | null } {
  const rows: ScheduleRow[] = [];
  let stoppedAtRow: number | null = null;
  let lastReal: ScheduleRow | undefined;

  for (let r = opts.startRow; r <= opts.endRow; r++) {
    const label = text(grid, r, opts.labelCol);
    if (opts.isStopLabel?.(label)) {
      stoppedAtRow = r;
      break;
    }
    if (YEAR_SEPARATOR.test(label)) continue;

    const cells: ScheduleCell[] = [];
    for (const { col, date } of opts.columns) {
      const t = text(grid, r, col);
      if (t) cells.push({ date, text: t });
    }

    const isContinuation = label === "" || label === ".";
    if (isContinuation) {
      // En prickad eller namnlös rad hör ihop med raden ovanför.
      if (cells.length && lastReal) {
        rows.push({ label: lastReal.label, sublabel: lastReal.sublabel, slot: 1, cells });
      }
      continue;
    }

    const sublabel = opts.subLabelCol !== undefined ? text(grid, r, opts.subLabelCol) || null : null;
    const row: ScheduleRow = { label, sublabel, slot: 0, cells };
    rows.push(row);
    lastReal = row;
  }

  return { board: { dates: opts.columns.map((c) => c.date), rows }, stoppedAtRow };
}

/**
 * Delar upp bladet i veckoblock.
 *
 * Datumen räknas ur veckonummer och veckodagsrubrik i stället för att
 * läsas ur datumcellerna. Bladets 2026-avsnitt är nämligen kopierat
 * från 2025 utan att datumen uppdaterades — där står "Vecka 27" med
 * datumen 2025-06-29 och framåt, en dag fel och ett år fel. Rubrikerna
 * och veckonumren stämmer däremot, och de går att räkna på.
 * dateMismatches räknar avvikelserna så de går att rapportera.
 */
export function parseScheduleSheet(grid: Grid): WeekBlock[] {
  const headers: Array<{ row: number; week: number }> = [];
  for (let r = 0; r < grid.length; r++) {
    const m = text(grid, r, DAY_LABEL).match(WEEK_HEADER);
    if (m) headers.push({ row: r, week: Number(m[1]) });
  }
  if (headers.length === 0) return [];

  // Startåret tas från det första blockets datumcell; därefter ökas
  // året varje gång veckonumret vänder (53 → 1).
  const firstDate = isoDate(grid, headers[0].row + 1, DAY_FIRST_HEADER);
  let year = firstDate ? isoWeek(firstDate).year : new Date().getUTCFullYear();

  return headers.map(({ row: headerRow, week }, i) => {
    if (i > 0 && week < headers[i - 1].week) year++;
    const endRow = (headers[i + 1]?.row ?? grid.length) - 1;
    const dateRow = headerRow + 1;

    const dayHeader = readWeekdayHeader(grid, headerRow, DAY_FIRST_HEADER);
    const dayColumns = dayHeader.map(({ col, weekday }) => ({
      col,
      date: dateForWeekday(year, week, weekday),
    }));

    // Högerblockets veckodagsrad står under datumraden och inleds med
    // etiketten "Ort". Antalet dagar varierar mellan bladets avsnitt.
    let farHeaderRow = -1;
    for (let r = headerRow + 1; r <= Math.min(headerRow + 4, endRow); r++) {
      if (text(grid, r, FAR_LABEL).toLowerCase() === "ort") {
        farHeaderRow = r;
        break;
      }
    }
    const farHeader = farHeaderRow >= 0 ? readWeekdayHeader(grid, farHeaderRow, FAR_LABEL + 1) : [];
    const farColumns = farHeader.map(({ col, weekday }) => ({
      col,
      date: dateForWeekday(year, week, weekday),
    }));

    let dateMismatches = 0;
    for (const { col, date } of dayColumns) {
      const inSheet = isoDate(grid, dateRow, col);
      if (inSheet && inSheet !== date) dateMismatches++;
    }

    const day = readSubBoard(grid, {
      labelCol: DAY_LABEL,
      subLabelCol: DAY_SUBLABEL,
      columns: dayColumns,
      startRow: headerRow + 2,
      endRow,
    }).board;

    const far = readSubBoard(grid, {
      labelCol: FAR_LABEL,
      columns: farColumns,
      startRow: farHeaderRow >= 0 ? farHeaderRow + 1 : headerRow + 3,
      endRow,
      isStopLabel: (l) => ABSENCE_HEADING.test(l),
    });

    const weekDates = [...new Set([...day.dates, ...far.board.dates])].sort();
    const absences: AbsenceEntry[] = [];
    const unparsedAbsenceText: string[] = [];

    if (far.stoppedAtRow !== null && farColumns.length) {
      const firstCol = farColumns[0].col;
      const lastCol = farColumns[farColumns.length - 1].col;
      for (let r = far.stoppedAtRow; r <= endRow; r++) {
        // En ny etikett i etikettkolumnen betyder att semesterrutan är slut.
        if (r > far.stoppedAtRow && text(grid, r, FAR_LABEL) !== "") break;
        for (let c = firstCol; c <= lastCol; c++) {
          const t = text(grid, r, c);
          if (!t) continue;
          const parsed = parseAbsenceText(t, weekDates);
          if (parsed) absences.push(parsed);
          else unparsedAbsenceText.push(t);
        }
      }
    }

    return {
      week,
      year,
      headerRow,
      day,
      far: far.board,
      absences,
      unparsedAbsenceText,
      dateMismatches,
    };
  });
}
