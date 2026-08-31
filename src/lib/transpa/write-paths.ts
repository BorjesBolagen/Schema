/**
 * Går det att skriva tillbaka till TransPA?
 *
 * Hela frågan för fas 3 (skicka schemaändring) och fas 4 (skicka
 * frånvaro). Svaret står i OpenAPI-specen, men spec-läsningen kastade
 * bort allt utom GET innan det nådde skärmen — så det gick inte att se,
 * och slutsatsen "det finns ingen skrivväg" var en gissning.
 *
 * Den här filen gissar inte. Den grupperar det specen faktiskt säger.
 */

export interface SpecWrite {
  path: string;
  method: string;
  summary?: string;
}

export type WriteTopic = "shifts" | "absence" | "employees" | "vehicles" | "other";

/**
 * Vad en skrivväg rör.
 *
 * Ordningen spelar roll: /v1/employees/{id}/shifts/ handlar om pass och
 * inte om personal, så pass måste prövas först.
 */
export function topicOf(path: string): WriteTopic {
  const p = path.toLowerCase();
  if (p.includes("shift")) return "shifts";
  if (/absence|leave|vacation|semester|frånvaro/.test(p)) return "absence";
  if (p.includes("employee")) return "employees";
  if (p.includes("vehicle")) return "vehicles";
  return "other";
}

export const TOPIC_LABEL: Record<WriteTopic, string> = {
  shifts: "Pass",
  absence: "Frånvaro",
  employees: "Personal",
  vehicles: "Fordon",
  other: "Övrigt",
};

/** Skrivvägarna grupperade på vad de rör, i den ordning som betyder något. */
export function groupWrites(writes: SpecWrite[]): Array<{ topic: WriteTopic; writes: SpecWrite[] }> {
  const ordning: WriteTopic[] = ["shifts", "absence", "employees", "vehicles", "other"];
  const grupper = new Map<WriteTopic, SpecWrite[]>();
  for (const w of writes) {
    const t = topicOf(w.path);
    grupper.set(t, [...(grupper.get(t) ?? []), w]);
  }
  return ordning
    .filter((t) => grupper.has(t))
    .map((topic) => ({
      topic,
      writes: [...grupper.get(topic)!].sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      ),
    }));
}

export interface WriteVerdict {
  /** Kan en schemaändring skickas tillbaka? */
  shifts: boolean;
  /** Kan en frånvaro skickas tillbaka? */
  absence: boolean;
  total: number;
}

/**
 * Kort svar på om fas 3 och 4 är byggbara.
 *
 * DELETE räknas inte som att kunna skriva ett pass: att kunna ta bort
 * ett pass utan att kunna skapa ett är ingen skrivväg för en flytt.
 */
export function writeVerdict(writes: SpecWrite[]): WriteVerdict {
  const skapar = (t: WriteTopic) =>
    writes.some((w) => topicOf(w.path) === t && w.method !== "DELETE");
  return { shifts: skapar("shifts"), absence: skapar("absence"), total: writes.length };
}
