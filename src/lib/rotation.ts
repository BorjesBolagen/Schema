/**
 * Rullande scheman.
 *
 * En del upplägg går inte att beskriva med "personen kör den här bilen".
 * I Värnamo roterar fyra pass över fyra veckor: den som kör pass 1 den
 * här veckan kör pass 2 nästa. Excelbladet löser det med en tabell som
 * mappar veckonummer till passnummer, och den tabellen är en cykel med
 * en förskjutning — inget mer.
 *
 * Cykeln hör till *kopplingen*, inte till tavlan. Det var fel förut: en
 * längd per tavla gick inte att skriva ned verkligheten i. Samma person
 * kan gå varannan vecka på en bil och var fjärde på en annan, och två
 * personer på samma tavla kan ha helt olika cykler. Att fältet fanns på
 * tavlan och tog emot ett värde gjorde dessutom att begränsningen inte
 * syntes förrän någon försökte.
 */

/** Längsta cykeln som går att välja. Tio veckor räcker för de
 * längsta rullande scheman som används i dag. */
export const MAX_CYCLE_WEEKS = 10;

/**
 * Vilken plats i cykeln en ISO-vecka hamnar på, räknat från 1.
 *
 * Kontrollerat mot Värnamobladets Lists-flik, som mappar vecka → pass:
 * med längd 4 och förskjutning 2 ger formeln vecka 1 → 3, vecka 2 → 4,
 * vecka 3 → 1, vecka 9 → 3 och vecka 31 → 1. Alla stämmer med bladet.
 *
 * Längd 1 ger alltid 1, vilket är vad en tavla utan rotation ska ge.
 */
export function cyclePosition(isoWeek: number, cycleLength: number, cycleOffset = 0): number {
  const längd = Math.max(1, Math.floor(cycleLength));
  // Modulo på ett negativt tal ger negativt i JS; +längd innan tar det.
  const rå = (((isoWeek - 1 + cycleOffset) % längd) + längd) % längd;
  return rå + 1;
}

/**
 * Gäller kopplingen den här veckan och den här veckodagen?
 *
 * Tomma listor betyder "alla" och inte "inga". Det är det enda rimliga
 * förvalet: en koppling utan angivna veckodagar är en stående koppling,
 * och den ska bete sig som den gjorde innan rotationerna fanns.
 */
export function appliesTo(
  rule: { cycleWeeks: number[] | null; weekdays: number[] | null },
  at: { position: number; weekday: number },
): boolean {
  const veckor = rule.cycleWeeks ?? [];
  const dagar = rule.weekdays ?? [];
  if (veckor.length > 0 && !veckor.includes(at.position)) return false;
  if (dagar.length > 0 && !dagar.includes(at.weekday)) return false;
  return true;
}

/**
 * Hur snävt en koppling är skriven, 0–2.
 *
 * Används för att avgöra vilken koppling som vinner när flera gäller
 * samma dag: den som pekar ut både cykelvecka och veckodag är skriven
 * för just det tillfället och ska slå den stående kopplingen. Utan den
 * ordningen skulle ett undantag aldrig kunna läggas ovanpå en regel —
 * man vore tvungen att skriva om huvudregeln varje gång.
 */
export function specificity(rule: {
  cycleWeeks: number[] | null;
  weekdays: number[] | null;
}): number {
  return ((rule.cycleWeeks?.length ?? 0) > 0 ? 1 : 0) + ((rule.weekdays?.length ?? 0) > 0 ? 1 : 0);
}

const VECKODAG_KORT = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];

/** Kort beskrivning av när en koppling gäller, för listan i bas-schemat. */
export function describeRule(
  rule: { cycleWeeks: number[] | null; weekdays: number[] | null },
  cycleLength: number,
): string {
  const delar: string[] = [];
  const dagar = rule.weekdays ?? [];
  const veckor = rule.cycleWeeks ?? [];

  if (dagar.length > 0) {
    delar.push([...dagar].sort((a, b) => ((a || 7) - (b || 7))).map((d) => VECKODAG_KORT[d]).join(", "));
  }
  if (veckor.length > 0 && cycleLength > 1) {
    delar.push(
      veckor.length === 1
        ? `v. ${veckor[0]} av ${cycleLength}`
        : `v. ${[...veckor].sort((a, b) => a - b).join("/")} av ${cycleLength}`,
    );
  }
  return delar.length ? delar.join(" · ") : "alltid";
}

/**
 * Vilka riktiga veckor en regel träffar härnäst.
 *
 * Ett cykelnummer säger ingenting i sig. "Vecka 2 av 4" är sant men
 * obekräftbart; "v. 36, 40, 44" går att hålla mot schemat planeraren
 * redan har. Det är skillnaden mellan en inställning man litar på och
 * en man hoppas på.
 *
 * Räknar framåt från och med den vecka som visas, och stannar när
 * antalet är fyllt eller sökningen gått ett par cykler utan träff.
 */
export function kommandeVeckor(input: {
  year: number;
  week: number;
  cycleLength: number;
  cycleOffset: number;
  cycleWeeks: number[];
  antal?: number;
}): number[] {
  const längd = Math.max(1, Math.floor(input.cycleLength));
  const valda = input.cycleWeeks.length > 0 ? input.cycleWeeks : null;
  const vill = input.antal ?? 4;

  const ut: number[] = [];
  /* Taket är två varv i cykeln plus lite: träffar regeln något gör den
     det inom ett varv, och utan tak vore en tom lista en oändlig loop. */
  for (let i = 0; i < längd * vill + längd && ut.length < vill; i++) {
    const vecka = input.week + i;
    const position = cyclePosition(vecka, längd, input.cycleOffset);
    if (!valda || valda.includes(position)) ut.push(vecka);
  }
  return ut;
}

/**
 * En linje i en persons veckoschema: vilken rad, och vilka dagar.
 * Tom lista dagar betyder alla dagar, som i kopplingen.
 */
export interface VeckoLinje {
  boardRowId: string;
  weekdays: number[];
}

/** Den första ISO-veckan som hamnar på plats `position` i cykeln. */
function förstaVeckanPå(position: number, längd: number, förskjutning: number): number {
  return ((((position - 1 - förskjutning) % längd) + längd) % längd) + 1;
}

/**
 * En persons kopplingar utlagda vecka för vecka i en cykel.
 *
 * Det är så planeraren tänker på en rotation: "vecka 1 kör hon BT13
 * mån–tors, vecka 2 BT24 hela veckan" — inte som en lista regler med
 * cykelnummer. En koppling utan cykelveckor står i varje vecka. En
 * koppling skriven i en annan cykellängd placeras efter den första
 * riktiga vecka som hamnar på varje plats, så att inget försvinner när
 * vyn öppnas.
 */
export function linjerPerCykelvecka(
  kopplingar: Array<{
    boardRowId: string;
    weekdays: number[] | null;
    cycleWeeks: number[] | null;
    cycleLength: number;
    cycleOffset: number;
    sortOrder: number;
  }>,
  längd: number,
  förskjutning: number,
): VeckoLinje[][] {
  const l = Math.max(1, Math.floor(längd));
  const ordnade = [...kopplingar].sort((a, b) => a.sortOrder - b.sortOrder);
  return Array.from({ length: l }, (_, i) => {
    const isoVecka = förstaVeckanPå(i + 1, l, förskjutning);
    return ordnade
      .filter((k) => {
        const veckor = k.cycleWeeks ?? [];
        if (veckor.length === 0) return true;
        return veckor.includes(cyclePosition(isoVecka, k.cycleLength, k.cycleOffset));
      })
      .map((k) => ({ boardRowId: k.boardRowId, weekdays: [...(k.weekdays ?? [])] }));
  });
}

/**
 * Tillbaka från veckor till kopplingar, en per vecka och linje.
 *
 * Ordningen inom veckan blir sortOrder: den översta linjen vinner när
 * två gäller samma dag, precis som i listan. Räknas löpande över alla
 * veckor så att listan i bas-schemat visar dem i veckoordning. I en cykel på en vecka
 * behövs inget cykelnummer — då blir det vanliga stående kopplingar.
 */
export function kopplingarFrånVeckor(
  veckor: VeckoLinje[][],
  längd: number,
  förskjutning: number,
): Array<{
  boardRowId: string;
  weekdays: number[] | null;
  cycleWeeks: number[] | null;
  cycleLength: number;
  cycleOffset: number;
  sortOrder: number;
}> {
  const l = Math.min(Math.max(1, Math.floor(längd)), MAX_CYCLE_WEEKS);
  const f = ((Math.floor(förskjutning) % l) + l) % l;
  const ut: ReturnType<typeof kopplingarFrånVeckor> = [];
  veckor.slice(0, l).forEach((linjer, i) => {
    linjer.forEach((linje) => {
      const dagar = [...new Set(linje.weekdays.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
      ut.push({
        boardRowId: linje.boardRowId,
        weekdays: dagar.length ? dagar : null,
        cycleWeeks: l > 1 ? [i + 1] : null,
        cycleLength: l,
        cycleOffset: l > 1 ? f : 0,
        sortOrder: ut.length,
      });
    });
  });
  return ut;
}
