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

/**
 * Riktningen på en persons nattpass på en linjebil, ur turordningen.
 *
 * Den som kör en linjebil flera nätter i följd går upp första natten,
 * ner nästa, upp den tredje och ner den fjärde — bilen står i andra
 * änden efter varje natt. Så när benämningen i TransPA inte säger
 * riktningen går den ändå att räkna ut ur ordningen.
 *
 * Indata är personens nattdatum på *en* rad, i valfri ordning, med
 * riktningen ur benämningen när den finns. En följd bryts när en dag
 * saknas, och nästa följd börjar om med upp.
 *
 * En känd riktning vinner över räkningen — benämningen beskriver resan
 * som faktiskt är planerad. Finns en känd natt i följden räknas de
 * okända ut från den, så att följden fortsätter växla runt den.
 */
export function alternatingNightDirections(
  nights: Array<{ date: string; known: Direction | null }>,
  addDays: (iso: string, days: number) => string,
): Map<string, Direction> {
  const byDate = new Map<string, Direction | null>();
  for (const n of nights) {
    // Två pass samma natt på samma rad: en känd riktning går före.
    if (!byDate.has(n.date) || byDate.get(n.date) === null) byDate.set(n.date, n.known);
  }
  const dates = [...byDate.keys()].sort();

  const runs: string[][] = [];
  for (const d of dates) {
    const run = runs[runs.length - 1];
    if (run && addDays(run[run.length - 1], 1) === d) run.push(d);
    else runs.push([d]);
  }

  const motsatt = (d: Direction): Direction => (d === "upp" ? "ner" : "upp");
  const result = new Map<string, Direction>();
  for (const run of runs) {
    const ankare = run.findIndex((d) => byDate.get(d));
    const ankareRiktning: Direction = ankare >= 0 ? byDate.get(run[ankare])! : "upp";
    const ankareIndex = Math.max(ankare, 0);
    run.forEach((d, i) => {
      const känd = byDate.get(d);
      result.set(
        d,
        känd ?? ((i - ankareIndex) % 2 === 0 ? ankareRiktning : motsatt(ankareRiktning)),
      );
    });
  }
  return result;
}
