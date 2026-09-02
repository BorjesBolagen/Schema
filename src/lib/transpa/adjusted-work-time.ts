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

/**
 * Kroppen till calculateAdjustedWorkTime.
 *
 * Ett *annat* schema än passets, och snävare. `adjustedWorkTime` har
 * `additionalProperties: false` och tillåter bara startDateTime, breaks,
 * partsOfDay och employeeId — och i partsOfDay bara endDateTime och
 * workTaskId. Passets vehicleId, customCounters, trailerVehicleId,
 * costDistributionCode, name, description, externalId, isExtraShift och
 * id hör inte hemma här.
 *
 * Vi skickade hela passet och kom igenom ändå: deras validering är
 * uppenbarligen tillåtande i dag. Men det är odefinierat beteende vi
 * lutar oss mot, och dagen de skärper valideringen slutar varje flytt
 * att fungera. Kroppen byggs därför efter schemat i stället för efter
 * vad som råkar accepteras.
 */
export function buildAdjustedWorkTimePayload(shift: {
  startDateTime?: string;
  employeeId?: string | null;
  breaks?: unknown;
  partsOfDay?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const rast = (b: unknown) => {
    const r = (b ?? {}) as Record<string, unknown>;
    return { startDateTime: r.startDateTime, endDateTime: r.endDateTime };
  };

  return {
    startDateTime: shift.startDateTime,
    breaks: (Array.isArray(shift.breaks) ? shift.breaks : []).map(rast),
    partsOfDay: (shift.partsOfDay ?? []).map((del) => ({
      endDateTime: del.endDateTime,
      /* Bara när det finns. undefined försvinner i JSON.stringify, men
         null är ett värde och kan betyda något annat för dem än "inte
         angivet". */
      ...(del.workTaskId != null ? { workTaskId: del.workTaskId } : {}),
    })),
    /* Utelämnas när passet saknar person. Schemat tillåter null, men
       employeeId får inte kombineras med collectiveAgreement, och att
       skicka fältet tomt är att påstå något vi inte vet. */
    ...(shift.employeeId != null ? { employeeId: shift.employeeId } : {}),
  };
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
