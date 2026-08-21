import type { Page } from "playwright-core";

/**
 * Loggar in i e2e-skripten.
 *
 * Uppgifterna kommer från seed-skriptet och går att styra med
 * E2E_EMAIL/E2E_PASSWORD när databasen satts upp med andra.
 */
export async function signIn(page: Page, base: string): Promise<void> {
  const email = process.env.E2E_EMAIL ?? "admin@example.se";
  const password = process.env.E2E_PASSWORD ?? "schema1234";

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
