import { addDays, isoMonday, parseIso, weekdayOf } from "./week";

export type Shift = "day" | "night";

/** En dag en person jobbar, och på vilket skift. */
export interface WorkDay {
  employeeId: string;
  date: string;
  shift: Shift;
}

/**
 * Svaret från en källa till arbetsdagar.
 *
 * `covered` är avgörande och skilt från `workDays`: den listar vilka
 * personer källan hade *besked* om, även när beskedet var "jobbar inte
 * alls den här veckan". Utan den skillnaden går det inte att avgöra om
 * en tom lista betyder ledighet eller okunskap, och en reservkälla
 * skulle hitta på arbetsdagar åt någon som faktiskt har semester.
 */
export interface WorkDayResult {
  workDays: WorkDay[];
  covered: string[];
}

export interface WorkDayProvider {
  readonly name: string;
  getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult>;
}

/* ------------------------------------------------------------------ *
 * Cykelberäkning
 * ------------------------------------------------------------------ */

export interface PatternLike {
  id: string;
  employeeId: string;
  cycleWeeks: number;
  /** Måndagen i den vecka som är cykelvecka 0. */
  anchorDate: string;
  /**
   * 1 = veckan börjar på måndag (normalfallet). 0 = veckan börjar på
   * söndag, som Värnamos rullschema är byggt: söndagen hör ihop med
   * måndagen som följer, inte med veckan den kalendermässigt ligger i.
   */
  weekStartsOn: number;
  validFrom: string | null;
  validTo: string | null;
}

export interface PatternDayLike {
  workPatternId: string;
  cycleWeek: number;
  /** 0 = söndag … 6 = lördag */
  weekday: number;
  shift: Shift;
}

const DAY_MS = 86_400_000;

/**
 * Var i cykeln ett datum hamnar.
 *
 * Räknas på hela ISO-veckor från ankarmåndagen, så alla dagar i samma
 * vecka får samma cykelvecka — även söndagen, som fjärrtavlorna visar
 * före måndagen.
 */
export function cycleWeekFor(
  anchorDate: string,
  cycleWeeks: number,
  date: string,
  weekStartsOn = 1,
): number {
  if (cycleWeeks <= 1) return 0;
  const anchor = parseIso(isoMonday(anchorDate)).getTime();
  // Börjar veckan på söndag räknas söndagen till veckan som följer.
  const effective = weekStartsOn === 0 && weekdayOf(date) === 0 ? addDays(date, 1) : date;
  const monday = parseIso(isoMonday(effective)).getTime();
  const weeks = Math.round((monday - anchor) / (7 * DAY_MS));
  return ((weeks % cycleWeeks) + cycleWeeks) % cycleWeeks;
}

export function patternCoversDate(p: PatternLike, date: string): boolean {
  if (p.validFrom && date < p.validFrom) return false;
  if (p.validTo && date > p.validTo) return false;
  return true;
}

/** Alla datum i intervallet, inklusive båda ändarna. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Veckar ut ett mönster till konkreta arbetsdagar.
 *
 * Flera mönster per person tillåts över tid; det som gäller datumet
 * vinner. Överlappar två mönster samma datum används det som börjar
 * senast, så en inskriven omläggning tar över utan att det gamla
 * behöver raderas.
 */
export function expandPatterns(
  patterns: PatternLike[],
  days: PatternDayLike[],
  from: string,
  to: string,
): WorkDay[] {
  const daysByPattern = new Map<string, PatternDayLike[]>();
  for (const d of days) {
    daysByPattern.set(d.workPatternId, [...(daysByPattern.get(d.workPatternId) ?? []), d]);
  }

  const byEmployee = new Map<string, PatternLike[]>();
  for (const p of patterns) {
    byEmployee.set(p.employeeId, [...(byEmployee.get(p.employeeId) ?? []), p]);
  }

  const out: WorkDay[] = [];
  for (const [employeeId, list] of byEmployee) {
    for (const date of datesBetween(from, to)) {
      const active = list
        .filter((p) => patternCoversDate(p, date))
        .sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))[0];
      if (!active) continue;

      const cycleWeek = cycleWeekFor(
        active.anchorDate,
        active.cycleWeeks,
        date,
        active.weekStartsOn,
      );
      const weekday = weekdayOf(date);
      for (const d of daysByPattern.get(active.id) ?? []) {
        if (d.cycleWeek === cycleWeek && d.weekday === weekday) {
          out.push({ employeeId, date, shift: d.shift });
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));
}

/* ------------------------------------------------------------------ *
 * Sammansatt källa
 * ------------------------------------------------------------------ */

/**
 * Frågar källorna i tur och ordning och faller tillbaka **per person**.
 *
 * Det gör övergången till TransPA gradvis: den som redan finns där
 * hämtas därifrån, medan övriga fortsätter läsas ur sitt lokala
 * mönster. Ingen behöver vänta på att alla är på plats.
 */
export class CompositeWorkDayProvider implements WorkDayProvider {
  readonly name: string;

  constructor(private readonly providers: WorkDayProvider[]) {
    // Namnge efter källorna, inte efter konstruktionen — det som ska
    // synas i appen är varifrån arbetsdagarna faktiskt kom.
    this.name = providers.map((p) => p.name).join(" → ") || "ingen källa";
  }

  async getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDayResult> {
    const workDays: WorkDay[] = [];
    const covered = new Set<string>();
    let remaining = [...employeeIds];

    for (const provider of this.providers) {
      if (remaining.length === 0) break;
      // Filtrera mot vilka vi faktiskt frågade om, inte mot vad källan
      // säger sig täcka — annars kan en källa som ignorerar sitt
      // argument skriva över en tidigare källas besked.
      const asked = new Set(remaining);
      const result = await provider.getWorkDays(remaining, from, to);
      const got = new Set(result.covered.filter((id) => asked.has(id)));
      for (const wd of result.workDays) {
        if (got.has(wd.employeeId)) workDays.push(wd);
      }
      for (const id of got) covered.add(id);
      remaining = remaining.filter((id) => !got.has(id));
    }

    return { workDays, covered: [...covered] };
  }
}
