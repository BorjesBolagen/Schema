import type { Page } from "playwright-core";

/**
 * Loggar in i e2e-skripten.
 *
 * Uppgifterna kommer från seed-skriptet och går att styra med
 * E2E_EMAIL/E2E_PASSWORD när databasen satts upp med andra.
 */
export async function signIn(
  page: Page,
  base: string,
  /** Andra uppgifter än förvalet, t.ex. läskontot i viewer-provet. */
  som?: { email: string; password: string },
): Promise<void> {
  const email = som?.email ?? process.env.E2E_EMAIL ?? "admin@example.se";
  const password = som?.password ?? process.env.E2E_PASSWORD ?? "schema-demo-2026";

  await page.goto(`${base}/logga-in`, { waitUntil: "networkidle" });
  if (!page.url().includes("/logga-in")) return; // redan inloggad

  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("logga-in"), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
}

/**
 * Veckan demounderlaget faktiskt fyller.
 *
 * Skripten pekade tidigare på vecka 34 rakt av. Demot fyller veckorna
 * runt *idag*, så den veckan gled ur intervallet när kalendern gick
 * vidare — och skripten började köra mot en tom tavla. De flesta
 * fortsatte vara gröna, eftersom de kontrollerade saker som inte kräver
 * data, vilket är sämre än att bli röda.
 */
export function seededWeek(): { year: number; week: number } {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Torsdagen i samma vecka avgör vilket år veckan tillhör (ISO-8601).
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const nyår = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - nyår.getTime()) / 86_400_000 + 1) / 7);
  return { year: utc.getUTCFullYear(), week };
}

/** "?ar=2026&vecka=36" för den vecka demot fyllt. */
export function weekQuery(): string {
  const { year, week } = seededWeek();
  return `?ar=${year}&vecka=${week}`;
}

/** Veckan efter, för de tester som behöver en grannvecka. */
export function nextWeekQuery(): string {
  const { year, week } = seededWeek();
  return `?ar=${year}&vecka=${week + 1}`;
}
