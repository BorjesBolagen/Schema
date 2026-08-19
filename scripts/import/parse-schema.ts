import { type Grid, isoDate, text } from "./xlsx";

/* Kolumnindex (nollbaserade) i bladet "Schema NYBHLF". */
const DAY_LABEL = 0; // A
const DAY_SUBLABEL = 1; // B
const DAY_FIRST = 2; // C — måndag
const DAY_LAST = 6; // G — fredag
const FAR_LABEL = 8; // I
const FAR_FIRST = 9; // J — söndag
const FAR_LAST = 14; // O — fredag

const WEEK_HEADER = /^Vecka\s+(\d+)$/i;

/**
 * Semesterrutan är olika rubricerad i olika veckor — "Semester",
 * "Semester/Lediga", "Lediga/Semester", "Semester:". Bara 14 av 82
 * veckoblock har någon rubrik alls.
 */
const ABSENCE_HEADING = /semester|lediga/i;

/** Årtalsrader ("2025", "2025/2026") delar av bladet och är inte turer. */
const YEAR_SEPARATOR = /^\d{4}(\s*\/\s*\d{4})?$/;

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
  headerRow: number;
  /** Vänsterblocket: rader = bil/linje, kolumner = måndag–fredag. */
  day: SubBoard;
  /** Högerblocket: rader = bil/linje, kolumner = söndag–fredag. */
  far: SubBoard;
  /** Poster ur semesterrutan som gick att tyda entydigt. */
  absences: AbsenceEntry[];
  /** Text ur semesterrutan som inte gick att tyda — går till granskning. */
  unparsedAbsenceText: string[];
}

const WEEKDAYS: Record<string, number> = {
  sön: 0, son: 0, sö: 0,
  mån: 1, man: 1, må: 1, ma: 1,
  tis: 2, ti: 2,
  ons: 3, on: 3,
  tors: 4, tor: 4, to: 4,
  fre: 5, fr: 5,
  lör: 6, lor: 6, lö: 6,
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
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
  if (!s) return null;

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
    const wd = WEEKDAYS[day[2].toLowerCase()];
    if (wd !== undefined) {
      const hit = weekDates.find((d) => weekdayOf(d) === wd);
      if (hit) return { raw: s, alias: day[1].trim(), fromDate: hit, toDate: hit };
    }
  }

  return null;
}

function readSubBoard(
  grid: Grid,
  opts: {
    labelCol: number;
    firstCol: number;
    lastCol: number;
    dateRow: number;
    startRow: number;
    endRow: number;
    isStopLabel?: (label: string) => boolean;
    subLabelCol?: number;
  },
): { board: SubBoard; stoppedAtRow: number | null } {
  const dates: string[] = [];
  for (let c = opts.firstCol; c <= opts.lastCol; c++) {
    const d = isoDate(grid, opts.dateRow, c);
    if (d) dates.push(d);
    else dates.push("");
  }

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
    for (let c = opts.firstCol; c <= opts.lastCol; c++) {
      const t = text(grid, r, c);
      const date = dates[c - opts.firstCol];
      if (t && date) cells.push({ date, text: t });
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

  return { board: { dates: dates.filter(Boolean), rows }, stoppedAtRow };
}

/** Delar upp bladet i veckoblock och läser båda tavlorna i varje block. */
export function parseScheduleSheet(grid: Grid): WeekBlock[] {
  const headers: Array<{ row: number; week: number }> = [];
  for (let r = 0; r < grid.length; r++) {
    const m = text(grid, r, DAY_LABEL).match(WEEK_HEADER);
    if (m) headers.push({ row: r, week: Number(m[1]) });
  }

  return headers.map(({ row: headerRow, week }, i) => {
    const endRow = (headers[i + 1]?.row ?? grid.length) - 1;
    const dateRow = headerRow + 1;

    const day = readSubBoard(grid, {
      labelCol: DAY_LABEL,
      subLabelCol: DAY_SUBLABEL,
      firstCol: DAY_FIRST,
      lastCol: DAY_LAST,
      dateRow,
      startRow: headerRow + 2,
      endRow,
    }).board;

    // Högerblocket har en extra rubrikrad med veckodagsnamn under datumraden.
    const far = readSubBoard(grid, {
      labelCol: FAR_LABEL,
      firstCol: FAR_FIRST,
      lastCol: FAR_LAST,
      dateRow,
      startRow: headerRow + 3,
      endRow,
      isStopLabel: (l) => ABSENCE_HEADING.test(l),
    });

    const weekDates = [...new Set([...day.dates, ...far.board.dates])].sort();
    const absences: AbsenceEntry[] = [];
    const unparsedAbsenceText: string[] = [];

    if (far.stoppedAtRow !== null) {
      for (let r = far.stoppedAtRow; r <= endRow; r++) {
        // En ny etikett i etikettkolumnen betyder att semesterrutan är slut.
        if (r > far.stoppedAtRow && text(grid, r, FAR_LABEL) !== "") break;
        for (let c = FAR_FIRST; c <= FAR_LAST; c++) {
          const t = text(grid, r, c);
          if (!t) continue;
          const parsed = parseAbsenceText(t, weekDates);
          if (parsed) absences.push(parsed);
          else unparsedAbsenceText.push(t);
        }
      }
    }

    return { week, headerRow, day, far: far.board, absences, unparsedAbsenceText };
  });
}

export { addDays, weekdayOf };
