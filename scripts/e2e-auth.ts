/** Inloggning, skydd av rutter och utloggning. */
import { weekQuery } from "./e2e-helpers";
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:3230";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
/* Skriptet räknade bara upp resultat och avslutade alltid med noll —
   ett prov som inte kan bli rött. Nu bär det sin egen utgångskod. */
let röda = 0;
const check = (n: string, ok: boolean) => {
  if (!ok) röda++;
  console.log(`  ${ok ? "✓" : "✗"} ${n}`);
};

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
await page.fill('input[name="password"]', "schema-demo-2026");
await Promise.all([
  page.waitForURL("**/tavla/fjarr-nybro**", { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForLoadState("networkidle");
check("landar på tavlan man ville åt", page.url().includes("/tavla/fjarr-nybro"));
check("rutnätet syns", (await page.locator("#boardWrap, table").count()) > 0);
check("visar vem som är inloggad", (await page.locator("body").innerText()).includes("Administratör"));

/* Inloggningen får inte gå att använda som vidarebefordran till en
   annan sajt.

   Ärligt om vad det här provet visar: hålet gick *inte* att utnyttja
   genom Next:s router. Jag provade med den gamla regeln kvar, och
   /\\ondsajt.example landade på startsidan ändå — routern gjorde om
   den till en intern väg. Regeln i lib/retur.ts är alltså ett bälte,
   inte en stängd dörr, och proven här skulle ha varit gröna även före
   rättningen.

   De får ändå stå: de fångar den dag omdirigeringen görs om till något
   som *inte* går genom routern — en rutt med Response.redirect, till
   exempel. Det är själva regeln som prövas i src/lib/retur.test.ts,
   och de proven blir röda på den gamla regeln. */
console.log("\nReturvägen:");
for (const ond of ["//ondsajt.example", "/\\ondsajt.example"]) {
  await page.goto(`${base}/konto`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Logga ut" }).click();
  await page.waitForURL("**/logga-in**", { timeout: 60_000 });

  await page.goto(`${base}/logga-in?retur=${encodeURIComponent(ond)}`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "admin@example.se");
  await page.fill('input[name="password"]', "schema-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  check(`stannar på egen värd trots retur=${ond}`, new URL(page.url()).host === new URL(base).host);
  check(`landar på startsidan trots retur=${ond}`, new URL(page.url()).pathname === "/");
}

/* Byte av eget lösenord kräver det nuvarande. Utan det räcker en
   stulen kaka för att ta över kontot: sätt ett eget, behåll sin egen
   session och kasta ut ägaren — sessionerna rivs ju vid byte. */
console.log("\nByta eget lösenord:");
const NYTT = "hamn-torsdag-kaffe-4";
const fyllLösenord = async (nuvarande: string, nytt: string) => {
  const fält = page.locator('input[type="password"]');
  await fält.nth(0).fill(nuvarande);
  await fält.nth(1).fill(nytt);
  await page.getByRole("button", { name: /Byt lösenord/ }).click();
  await page.waitForTimeout(1500);
  return page.locator('[role="status"]').innerText();
};

await page.goto(`${base}/konto`, { waitUntil: "networkidle" });
check("formuläret frågar efter det nuvarande", (await page.locator('input[type="password"]').count()) === 2);
check("nekar med fel nuvarande", (await fyllLösenord("fel-losenord-helt", NYTT)).includes("stämmer inte"));

await page.goto(`${base}/konto`, { waitUntil: "networkidle" });
check("byter med rätt nuvarande", (await fyllLösenord("schema-demo-2026", NYTT)).includes("bytt"));

/* Tillbaka till utgångsläget, annars går nästa körning inte att logga
   in i — och att provet lämnar underlaget som det fann det hör till
   provet. */
await page.goto(`${base}/konto`, { waitUntil: "networkidle" });
check("byter tillbaka", (await fyllLösenord(NYTT, "schema-demo-2026")).includes("bytt"));

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
process.exit(röda === 0 ? 0 : 1);
