/** Inloggning, skydd av rutter och utloggning. */
import { weekQuery } from "./e2e-helpers";
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:3230";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
const check = (n: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${n}`);

await page.goto(`${base}/tavla/fjarr-nybro`, { waitUntil: "networkidle" });
console.log("Utan inloggning:");
check("skickas till inloggningen", page.url().includes("/logga-in"));
check("returvägen sparas", page.url().includes("retur=%2Ftavla%2Ffjarr-nybro"));

console.log("\nFel lösenord:");
await page.fill('input[name="email"]', "admin@example.se");
await page.fill('input[name="password"]', "fel-losenord");
await page.click('button[type="submit"]');
await page.waitForTimeout(1200);
check("visar felmeddelande", (await page.locator('[role="alert"]').count()) > 0);
check("stannar kvar på inloggningen", page.url().includes("/logga-in"));

console.log("\nRätt lösenord:");
await page.fill('input[name="password"]', "schema1234");
await Promise.all([
  page.waitForURL("**/tavla/fjarr-nybro**", { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForLoadState("networkidle");
check("landar på tavlan man ville åt", page.url().includes("/tavla/fjarr-nybro"));
check("rutnätet syns", (await page.locator("#boardWrap, table").count()) > 0);
check("visar vem som är inloggad", (await page.locator("body").innerText()).includes("Administratör"));

console.log("\nSessionen håller:");
await page.goto(`${base}/tavla/fjarr-nybro/semester?ar=2026`, { waitUntil: "networkidle" });
check("semestervyn öppnas", (await page.locator("h1").innerText()).includes("Semesterplanering"));

const dl = await page.request.get(`${base}/tavla/fjarr-nybro/export${weekQuery()}&vy=resource`);
check("Excel-exporten svarar 200", dl.status() === 200);

console.log("\nUtloggning:");
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL("**/logga-in**", { timeout: 60_000 }),
  page.getByRole("button", { name: "Logga ut" }).click(),
]);
check("tillbaka till inloggningen", page.url().includes("/logga-in"));
await page.goto(`${base}/`, { waitUntil: "networkidle" });
check("sessionen är borta", page.url().includes("/logga-in"));

console.log("\nJS-fel:", errs.length ? errs.slice(0, 3) : "inga");
await browser.close();
