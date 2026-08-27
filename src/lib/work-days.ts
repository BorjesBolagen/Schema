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
