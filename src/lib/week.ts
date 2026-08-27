/**
 * Veckohantering.
 *
 * Veckonumret är alltid ISO-8601 (måndagsbaserat) — det är det svenska
 * "vecka 27" alla syftar på. Vilken dag tavlan *visar* först är en
 * separat inställning: fjärrbladen inleder veckan med söndagen före
 * ISO-måndagen, lotsbladen börjar på måndagen.
 */

const DAY_MS = 86_400_000;

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(parseIso(iso).getTime() + days * DAY_MS));
}

/** 0 = söndag … 6 = lördag. */
export function weekdayOf(iso: string): number {
  return parseIso(iso).getUTCDay();
}

/** Måndagen i ISO-veckan som datumet tillhör. */
export function isoMonday(iso: string): string {
  const d = parseIso(iso);
  const shift = (d.getUTCDay() + 6) % 7; // måndag = 0
  return toIso(new Date(d.getTime() - shift * DAY_MS));
}

/** ISO-veckonummer och det år veckan hör till (kan skilja sig i årsskiftet). */
export function isoWeek(iso: string): { year: number; week: number } {
  const monday = parseIso(isoMonday(iso));
  // Torsdagen avgör vilket år veckan tillhör.
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstMonday = parseIso(isoMonday(toIso(firstThursday)));
  const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * DAY_MS)) + 1;
  return { year, week };
}

/** Måndagen i en given ISO-vecka. */
export function mondayOfWeek(year: number, week: number): string {
  const firstMonday = isoMonday(toIso(new Date(Date.UTC(year, 0, 4))));
  return addDays(firstMonday, (week - 1) * 7);
}

/** Antal ISO-veckor i ett år — 52 eller 53. */
export function weeksInYear(year: number): number {
  return isoWeek(toIso(new Date(Date.UTC(year, 11, 28)))).week;
}

/**
 * Datumen en tavla visar för en vecka.
 *
 * weekStartsOn = 1 ger måndag–söndag, 0 ger söndagen före ISO-måndagen
 * och framåt. visibleWeekdays filtrerar sedan bort de dagar tavlan inte
 * använder, med veckodagsnummer 0–6.
 */
export function weekDates(
  year: number,
  week: number,
  weekStartsOn: number,
  visibleWeekdays: number[],
): string[] {
  const monday = mondayOfWeek(year, week);
  const start = weekStartsOn === 0 ? addDays(monday, -1) : addDays(monday, weekStartsOn - 1);
  const visible = new Set(visibleWeekdays);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) =>
    visible.has(weekdayOf(d)),
  );
}

/**
 * Hela veckans spann, oavsett vilka dagar tavlan visar.
 *
 * weekDates ger de *synliga* dagarna, och det duger för att rita och
 * för att lägga ut. Men den som ska rensa en vecka måste träffa allt
 * som ligger i den: ett pass på en dold lördag är osynligt men verkligt,
 * och att lämna kvar det efter en rensning vore en lögn.
 */
export function weekSpan(
  year: number,
  week: number,
  weekStartsOn: number,
): { from: string; to: string } {
  const monday = mondayOfWeek(year, week);
  const start = weekStartsOn === 0 ? addDays(monday, -1) : addDays(monday, weekStartsOn - 1);
  return { from: start, to: addDays(start, 6) };
}

const WEEKDAY_NAMES = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];
const MONTHS = ["jan", "feb", "mars", "april", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[weekdayOf(iso)];
}

/** "Mån 3" — rubriken över en dagkolumn. */
export function shortDayLabel(iso: string): string {
  const d = parseIso(iso);
  return `${weekdayName(iso).slice(0, 3)} ${d.getUTCDate()}`;
}

/** "3–9 aug 2026" eller "29 juni–4 juli 2025" när veckan spänner två månader. */
export function dateRangeLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const a = parseIso(dates[0]);
  const b = parseIso(dates[dates.length - 1]);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = sameMonth ? `${a.getUTCDate()}` : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  return `${left}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}
