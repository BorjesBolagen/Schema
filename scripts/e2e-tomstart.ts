/**
 * Provar vägen från tom databas: logga in, skapa en tavla, lägg in
 * stationsort, personal och fordon. Det är den väg en ny installation
 * tar innan TransPA-synken finns, och den ska inte gå i stå någonstans.
 *
 *   BASE_URL=… E2E_EMAIL=… E2E_PASSWORD=… npx tsx scripts/e2e-tomstart.ts
 */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3250";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

await signIn(page, base);
check("loggar in", !page.url().includes("logga-in"));

const start = (await page.textContent("body")) ?? "";
check("tom databas erbjuder att skapa tavla", start.includes("Inga tavlor ännu"));
check("formuläret är öppet direkt", await page.isVisible('button:text("Skapa tavla")'));

await page.fill('input[placeholder="Fjärr Nybro/Hultsfred"]', "Fjärr Nybro");
await Promise.all([
  page.waitForURL(/\/tavla\//, { timeout: 30_000 }),
  page.click('button:text("Skapa tavla")'),
]);
await page.waitForLoadState("networkidle");
check("slug blir läsbar", page.url().includes("/tavla/fjarr-nybro"));

const boardText = (await page.textContent("body")) ?? "";
check("tavlan har startrader", boardText.includes("Bil 1") && boardText.includes("Bil 4"));

await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });
await page.click('button:text("Stationsorter")');
await page.fill('input[placeholder="Nybro"]', "Nybro");
await page.click('div:has(> label:has(input[placeholder="Nybro"])) button:text("Lägg till")');
// Ortens namn står i ett fält, inte som text — listan är redigerbar på plats.
await page.waitForFunction(
  () => [...document.querySelectorAll("li input")].some((i) => (i as HTMLInputElement).value === "Nybro"),
  { timeout: 15_000 },
);
check("stationsort går att lägga in", true);

await page.click('button:text("Personal")');
await page.fill('label:has-text("Förnamn") input', "Björn");
await page.fill('label:has-text("Efternamn") input', "Westman");
await page.fill('label:has-text("Anst.nr") input', "2262");
await page.selectOption('div.rounded label:has-text("Stationsort") select', { label: "Nybro" });
await page.click('div.rounded.border button:text("Lägg till")');
await page.waitForFunction(() => document.body.innerText.includes("Björn Westman"), { timeout: 15_000 });
check("personal går att lägga in", true);

await page.click('button:text("Fordon")');
await page.fill('input[placeholder="BT08"]', "BT13");
await page.click('div.rounded.border button:text("Lägg till")');
await page.waitForFunction(
  () => [...document.querySelectorAll("td input")].some((i) => (i as HTMLInputElement).value === "BT13"),
  { timeout: 15_000 },
);
check("fordon går att lägga in", true);

// Personen ska nu gå att välja som bemanning på tavlan.
await page.goto(`${base}/tavla/fjarr-nybro`, { waitUntil: "networkidle" });
const board = (await page.textContent("body")) ?? "";
check("tavlan är kvar efter grunddatan", board.includes("Fjärr Nybro"));

await browser.close();

for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
