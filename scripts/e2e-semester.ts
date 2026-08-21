/** Markerar och tar bort semesterveckor genom att dra i årsvyn. */
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:3220";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 700 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
const check = (n: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${n}`);

await page.goto(`${base}/tavla/fjarr-nybro/semester?ar=2026`, { waitUntil: "networkidle" });

const row = (name: string) => page.locator(`tbody tr:has(th:text-is("${name}"))`).first();
const cellsOf = async (name: string) => row(name).locator("td");
const marked = async (name: string) => {
  const tds = await (await cellsOf(name)).all();
  let n = 0;
  for (const td of tds) if (await td.evaluate((el) => !!el.getAttribute("style"))) n++;
  return n;
};
const staffing = async (week: number) =>
  (await page.locator('tbody tr:has(th:text-is("Bemanning kvar")) td').nth(week - 1).innerText()).trim();

const person = "Peter Mauritzson";
const before = await marked(person);
console.log(`${person}: ${before} markerade veckor, bemanning v.20 = ${await staffing(20)}`);

/* Dra över vecka 20–22. */
const tds = await (await cellsOf(person)).all();
const box = async (i: number) => (await tds[i].boundingBox())!;
const a = await box(19);
const b = await box(21);
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
for (const i of [20, 21]) {
  const c = await box(i);
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.waitForTimeout(60);
}
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.up();
await page.waitForTimeout(1800);

const after = await marked(person);
console.log("\nEfter dragning:");
check("tre veckor tillkom", after === before + 3);
check("bemanningen minskade v.20", (await staffing(20)) === "6");

/* Dra över samma veckor igen för att ta bort dem. */
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.up();
await page.waitForTimeout(2500);

console.log("\nEfter andra dragningen:");
check("veckorna borttagna igen", (await marked(person)) === before);
check("bemanningen återställd", (await staffing(20)) === "7");

await page.screenshot({ path: "/tmp/semester3.png" });
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
