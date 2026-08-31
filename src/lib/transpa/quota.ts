/**
 * TransPA:s anropskvot.
 *
 * Prenumerationen har ett tak för antal anrop, och över taket svarar
 * API:t 429 med hur lång tid som återstår:
 *
 *   "Out of call volume quota. Quota will be replenished in 1.16:10:17"
 *
 * Två saker följer av det. Felet ska läsas som vad det är — kvoten är
 * slut, inte "passet finns inte" — och resten av anropen ska ställas in.
 * Diagnostiksidan gör ett trettiotal anrop per körning; att låta dem gå
 * i väg mot ett tak som redan är nått gör bara nästa påfyllning
 * senare.
 */

/** Tiden TransPA anger, i .NET:s TimeSpan-format: [d.]hh:mm:ss[.fff] */
export function parseReplenish(text: string): number | null {
  const m = /replenished in\s+(?:(\d+)\.)?(\d+):(\d+):(\d+)/i.exec(text);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    ((Number(d ?? 0) * 24 + Number(h)) * 60 + Number(min)) * 60_000 +
    Number(s) * 1000
  );
}

/** "1 dygn 16 tim" — det planeraren behöver veta, inte sekunderna. */
export function humanDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  const d = Math.floor(min / (60 * 24));
  const h = Math.floor((min % (60 * 24)) / 60);
  const m = min % 60;
  const delar = [
    d > 0 ? `${d} dygn` : null,
    h > 0 ? `${h} tim` : null,
    d === 0 && m > 0 ? `${m} min` : null,
  ].filter(Boolean);
  return delar.length ? delar.join(" ") : "mindre än en minut";
}

/**
 * När kvoten tidigast är påfylld igen.
 *
 * Lever i processen och försvinner när instansen gör det. Det duger:
 * syftet är att stoppa de trettio följdanropen i *samma* körning, inte
 * att vara ett register. En ny instans provar en gång till och får sitt
 * eget 429 — ett bortkastat anrop, inte trettio.
 */
let blockedUntil = 0;

export function noteQuotaExhausted(replenishMs: number | null): void {
  const until = Date.now() + (replenishMs ?? 60_000);
  if (until > blockedUntil) blockedUntil = until;
}

/** Kvarvarande spärrtid i millisekunder, eller 0 när kvoten är öppen. */
export function quotaBlockedFor(now = Date.now()): number {
  return Math.max(0, blockedUntil - now);
}

/** Bara för tester — processen är delad mellan dem. */
export function clearQuotaBlock(): void {
  blockedUntil = 0;
}
