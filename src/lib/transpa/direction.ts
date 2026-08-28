/**
 * Riktningen på ett linjepass — upp eller ner.
 *
 * En linje körs av två bilar som möts på vägen: den ena går upp mot
 * Stockholm medan den andra går ner mot Värnamo, och nästa natt byter
 * de. Båda står på samma rad samma natt, och utan riktning går det inte
 * att se vem som gör vad.
 *
 * Uppgiften finns redan. TransPA:s benämning på passet bär den i
 * klartext — "Vmo-Sto ner", "Vmo-Sto upp 19.00", "Vmo-Sthlm Upp" — så
 * den läses därifrån i stället för att underhållas en gång till här.
 * Det är hela poängen med verktyget: en sanning, inte två.
 */

export type Direction = "upp" | "ner";

/**
 * Ordgränser, inte delsträngar.
 *
 * "Uppsala" innehåller "upp" och är en ort man kan köra till. En
 * delsträngsmatchning hade kallat varje Uppsalatur för en upptur.
 * \b räcker: efter "upp" i "Uppsala" står ett bokstavstecken, så
 * gränsen finns inte där.
 */
const UPP = /\bupp\b/iu;
const NER = /\bner\b/iu;

/**
 * Riktningen ur passets benämning, eller null när den inte går att läsa.
 *
 * Null är ett riktigt svar och ska visas som okänd, inte gissas bort.
 * Står båda orden i samma benämning säger texten emot sig själv, och då
 * är null ärligare än att välja det ena.
 */
export function parseDirection(name: string | null | undefined): Direction | null {
  if (!name) return null;
  const upp = UPP.test(name);
  const ner = NER.test(name);
  if (upp === ner) return null;
  return upp ? "upp" : "ner";
}

/**
 * Fyllda trianglar, inte tunna pilar.
 *
 * ↑ och ↓ är hårstrecksglyfer som försvinner i ett tätt rutnät, och de
 * två skiljer sig bara på vilken ände spetsen sitter. ▲ och ▼ har en
 * massa att känna igen på avstånd och läses även i utskrift, där färgen
 * kan falla bort.
 */
export const DIRECTION_ARROW: Record<Direction, string> = { upp: "▲", ner: "▼" };
export const DIRECTION_LABEL: Record<Direction, string> = { upp: "Upp", ner: "Ner" };
