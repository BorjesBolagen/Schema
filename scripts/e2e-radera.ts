/**
 * Ta bort en tavla: bekräftelsen ska säga vad som försvinner, och rätt
 * saker ska överleva. Personal och frånvaro hör inte till tavlan.
 */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3260";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const checks: Array<[string, boolean]> = [];
const check = (n: string, ok: boolean) => checks.push([n, ok]);

await signIn(page, base);

// Skapa en tavla att offra.
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.click('button:text("Ny tavla")');
const name = `Raderas ${Date.now()}`;
await page.fill('input[placeholder="Fjärr Nybro/Hultsfred"]', name);
await Promise.all([page.waitForURL(/\/tavla\//, { timeout: 30000 }), page.click('button:text("Skapa tavla")')]);
await page.waitForLoadState("networkidle");
const slug = new URL(page.url()).pathname.split("/")[2];

// Öppna tavelredigeraren och gå till borttagningen.
await page.getByRole("button", { name: "⚙ Tavla" }).click();
await page.waitForTimeout(500);
check("borttagning syns för admin", await page.isVisible('button:text("Ta bort tavlan…")'));

await page.click('button:text("Ta bort tavlan…")');
await page.waitForSelector(`text=Ta bort ${name}?`, { timeout: 15000 });
const dialog = await page.locator("section:has-text('Ta bort tavlan')").innerText();
check("bekräftelsen räknar raderna", /4 rader/.test(dialog));
check("bekräftelsen nämner pass", /utlagda pass/.test(dialog));
check("säger att det inte går att ångra", /går inte att ångra/.test(dialog));

// Avbryt först — inget ska hända.
await page.click('button:text-is("Avbryt")');
await page.waitForTimeout(400);
check("avbryt lämnar tavlan i fred", await page.isVisible('button:text("Ta bort tavlan…")'));

// Ta bort på riktigt.
await page.click('button:text("Ta bort tavlan…")');
await page.waitForSelector(`text=Ta bort ${name}?`, { timeout: 15000 });
await Promise.all([
  page.waitForURL((u) => u.pathname === "/", { timeout: 30000 }),
  page.click('button:text("Ja, ta bort")'),
]);
await page.waitForLoadState("networkidle");

const start = (await page.textContent("body")) ?? "";
check("tavlan är borta från listan", !start.includes(name));

/* Direktlänken ska visa "hittades inte", inte en trasig sida. Statusen
   kontrolleras inte: Next strömmar sidan, så notFound() hinner inte
   sätta 404 — en slug som aldrig funnits beter sig likadant. */
await page.goto(`${base}/tavla/${slug}`, { waitUntil: "networkidle" });
const gone = (await page.textContent("body")) ?? "";
check("direktlänken visar inte tavlan", !gone.includes("Bil 1"));

// Personalen och andra tavlor ska vara orörda.
await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });
check("personalen finns kvar", ((await page.textContent("body")) ?? "").includes("Westman"));
await page.goto(`${base}/tavla/fjarr-nybro`, { waitUntil: "networkidle" });
const other = (await page.textContent("body")) ?? "";
// Namnen, inte radetiketterna: e2e-editor döper om rader i samma databas.
check("andra tavlor är orörda", other.includes("Elin Karlsson") && other.includes("BT13/14"));

await browser.close();
for (const [n, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${n}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
