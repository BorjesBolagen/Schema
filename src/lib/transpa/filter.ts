/**
 * TransPA:s filtersyntax.
 *
 * Formen är {fält}{jämförare}{värde}, ihopkopplade med {operator}:
 *   ?filter=id$eq:07e9b5d1$and:status$eq:approved
 *   ?filter=employeeId$in:[a,b]
 *
 * Byggaren finns för att strängarna annars skrivs för hand på varje
 * anropsställe, där ett glömt kolon blir ett tyst felaktigt filter i
 * stället för ett fel.
 */

export type Comparator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "nin";
export type Operator = "and" | "or";

export interface Condition {
  field: string;
  comparator: Comparator;
  value: string | number | Array<string | number>;
}

function renderValue(c: Condition): string {
  if (c.comparator === "in" || c.comparator === "nin") {
    const list = Array.isArray(c.value) ? c.value : [c.value];
    return `[${list.join(",")}]`;
  }
  if (Array.isArray(c.value)) {
    throw new Error(`Jämföraren $${c.comparator} tar ett enda värde, inte en lista`);
  }
  return String(c.value);
}

/** En enskild villkorssträng, t.ex. `startDateTime$gte:2026-08-01T00:00:00Z`. */
export function condition(field: string, comparator: Comparator, value: Condition["value"]): string {
  return `${field}$${comparator}:${renderValue({ field, comparator, value })}`;
}

/**
 * Kopplar ihop villkor med samma operator.
 *
 * TransPA har ingen parentessyntax, så villkoren kedjas platt och
 * utvärderas i den ordning de skrivs.
 */
export function joinConditions(conditions: string[], operator: Operator = "and"): string {
  return conditions.filter(Boolean).join(`$${operator}:`);
}

/** Villkor för att ett tidsspann överlappar [from, to). */
export function overlapsRange(fromField: string, from: string, to: string): string {
  return joinConditions([condition(fromField, "gte", from), condition(fromField, "lt", to)]);
}

/**
 * TransPA avvisar filter längre än så här.
 *
 * Gränsen märks först i skarp drift: `employeeId$in:[…]` med GUID:er
 * spränger den redan vid sju personer, och svaret är ett rakt
 * "Filter is too long. Max length is 400 characters." Därför delas
 * långa listor upp i flera anrop i stället för att skickas i ett.
 */
export const MAX_FILTER_LENGTH = 400;

export class FilterTooLongError extends Error {
  constructor(readonly length: number) {
    super(
      `Filtret blir ${length} tecken även med ett enda värde, men TransPA tar högst ${MAX_FILTER_LENGTH}.`,
    );
    this.name = "FilterTooLongError";
  }
}

/**
 * Delar upp en värdelista så att varje färdigt filter håller sig under
 * gränsen.
 *
 * `build` får en delmängd och returnerar hela filtersträngen för den —
 * så mäts det som faktiskt skickas, inklusive villkoren runt omkring,
 * i stället för att en marginal gissas fram.
 */
export function batchByFilterLength<T extends string | number>(
  values: T[],
  build: (batch: T[]) => string,
  maxLength = MAX_FILTER_LENGTH,
): T[][] {
  if (values.length === 0) return [];

  const batches: T[][] = [];
  let current: T[] = [];

  for (const value of values) {
    const candidate = [...current, value];
    if (build(candidate).length <= maxLength) {
      current = candidate;
      continue;
    }

    // Ryms inte ens ett ensamt värde är det villkoren runt omkring som
    // är för långa, och då hjälper ingen uppdelning.
    if (current.length === 0) throw new FilterTooLongError(build(candidate).length);

    batches.push(current);
    current = [value];
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
