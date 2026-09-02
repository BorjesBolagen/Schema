/**
 * Checksumman TransPA kräver för att ta emot en skrivning.
 *
 * PUT /v1/shifts/{id} och POST /v1/shifts/ har båda en obligatorisk
 * frågeparameter `checkSum`, beskriven som "Checksum retrieved from
 * calculateAdjustedWorkTime resource". Utan den svarar API:t 404 —
 * samma sak som listvägen gör utan sina datumparametrar. Det var
 * felet: vägen fanns, passet fanns, men begäran saknade en parameter
 * och svaret sa "Resource not found".
 *
 * Poängen med konstruktionen är att adjustedWorkTimeInMinutes inte får
 * hittas på av en klient. Fältet är *arbetad* tid, alltså passets längd
 * minus rasterna, och hur den räknas beror på tenantens
 * tidrapportinställningar. Man skickar därför passet till
 * calculateAdjustedWorkTime, får tillbaka värdet och en checksumma som
 * visar att värdet kommer därifrån, och skickar båda vidare.
 */

export const CALCULATE_PATH = "/v1/calculateAdjustedWorkTime";

export class AdjustedWorkTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustedWorkTimeError";
  }
}

export interface AdjustedWorkTime {
  checkSum: string;
  /** Värdet TransPA räknade fram. Deras siffra gäller, inte vår. */
  adjustedWorkTimeInMinutes?: number;
}

/** Nycklarna på toppnivån och ett steg ned, för felmeddelandet. */
function keysOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(k);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...Object.keys(v as object).map((inner) => `${k}.${inner}`));
    }
  }
  return out;
}

/** Letar ett fält på toppnivån eller ett steg ned, utan hänsyn till skiftläge. */
function pick(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const direct = entries.find(([k]) => k.toLowerCase() === name);
  if (direct) return direct[1];
  for (const [, v] of entries) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = Object.entries(v as Record<string, unknown>).find(
        ([k]) => k.toLowerCase() === name,
      );
      if (nested) return nested[1];
    }
  }
  return undefined;
}

/**
 * Plockar ut checksumman ur svaret.
 *
 * Skiftlägesokänsligt och ett steg ned i eventuella kuvert, av samma
 * skäl som listsvaren läses så: Vismas genererade klient är PascalCase
 * medan deras egna exempel är camelCase, och vilket det blir syns först
 * i ett riktigt svar. Saknas den kastas ett fel som räknar upp
 * nycklarna som *fanns* — det är den upplysningen som gör nästa försök
 * billigt, och skrivningen sparar meddelandet i utkorgen.
 */
export function readAdjustedWorkTime(response: unknown): AdjustedWorkTime {
  const checkSum = pick(response, "checksum");
  if (typeof checkSum !== "string" || checkSum === "") {
    throw new AdjustedWorkTimeError(
      `Svaret från ${CALCULATE_PATH} bar ingen checkSum. Nycklar i svaret: ` +
        `${keysOf(response).join(", ") || "inga"}.`,
    );
  }

  const minutes = pick(response, "adjustedworktimeinminutes");
  return {
    checkSum,
    adjustedWorkTimeInMinutes: typeof minutes === "number" ? minutes : undefined,
  };
}
