/**
 * Hela vägen från tom databas: skapa första admin, logga in, lägg upp
 * en planerare med begränsad tavelåtkomst, och kontrollera att gränsen
 * håller.
 */
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:3242";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
const check = (n: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${n}`);

const ADMIN = { email: "johan@borjeskoncernen.se", pw: "hästar över ängen" };
const PLANNER = { email: "planerare@borjeskoncernen.se", pw: "vinter vid vättern" };

console.log("Tom databas:");
await page.goto(`${base}/`, { waitUntil: "networkidle" });
check("leds till kom-igång", page.url().includes("/kom-igang"));

await page.fill('input[name="name"]', "Johan");
await page.fill('input[name="email"]', ADMIN.email);
await page.fill('input[name="password"]', "kort");
check("för kort lösenord blockeras", await page.locator('button[type="submit"]').isDisabled());

await page.fill('input[name="password"]', ADMIN.pw);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("kom-igang"), { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForLoadState("networkidle");
check("admin skapad och inloggad", (await page.locator("body").innerText()).includes("Johan"));

console.log("\nKom-igång stängs:");
await page.goto(`${base}/kom-igang`, { waitUntil: "networkidle" });
check("sidan går inte längre att nå", !page.url().includes("/kom-igang"));

console.log("\nSkapa planerare:");
await page.goto(`${base}/anvandare`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Lägg till användare" }).click();
await page.fill('input[name="name"]', "Planerare");
await page.fill('input[name="email"]', PLANNER.email);
await page.locator('form input[type="text"]').last().fill(PLANNER.pw);
await page.getByRole("button", { name: "Skapa" }).click();
await page.waitForTimeout(2500);
check("planeraren finns i listan", (await page.locator("tbody").innerText()).includes(PLANNER.email));

console.log("\nPlaneraren utan tavlor:");
const other = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const p2 = await other.newPage();
await p2.goto(`${base}/logga-in`, { waitUntil: "networkidle" });
await p2.fill('input[name="email"]', PLANNER.email);
await p2.fill('input[name="password"]', PLANNER.pw);
await Promise.all([
  p2.waitForURL((u) => !u.pathname.includes("logga-in"), { timeout: 60_000 }),
  p2.click('button[type="submit"]'),
]);
await p2.waitForLoadState("networkidle");
const body = await p2.locator("body").innerText();
check("ser inga tavlor", body.includes("inte fått tillgång"));
check("når inte användarhanteringen", await p2.goto(`${base}/anvandare`).then(() => !p2.url().includes("/anvandare")));

console.log("\nLösenordsbyte:");
await p2.goto(`${base}/konto`, { waitUntil: "networkidle" });
await p2.fill('input[type="password"]', "sommar vid kalmarsund");
await p2.getByRole("button", { name: "Byt lösenord" }).click();
await p2.waitForTimeout(2000);
check("bytet bekräftas", (await p2.locator("body").innerText()).includes("Lösenordet är bytt"));

console.log("\nSpärr efter felförsök:");
const p3 = await (await browser.newContext()).newPage();
await p3.goto(`${base}/logga-in`, { waitUntil: "networkidle" });
for (let i = 0; i < 9; i++) {
  await p3.fill('input[name="email"]', PLANNER.email);
  await p3.fill('input[name="password"]', `fel-${i}-långt-nog`);
  await p3.click('button[type="submit"]');
  await p3.waitForTimeout(400);
}
check("kontot spärras", (await p3.locator("body").innerText()).includes("spärrat"));

console.log("\nJS-fel:", errs.length ? errs.slice(0, 3) : "inga");
await browser.close();
