/**
 * Ordningen mellan en persons bas-schemakopplingar.
 *
 * Kopplas någon till två bilar på samma skift måste valet vara
 * förutsägbart. Förut togs en av dem ur databasens godtyckliga
 * radordning, så personen kunde byta bil mellan två tryck på "Fyll
 * veckan" utan att något sagt ifrån.
 */
import { chromium } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3330";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);
const dialog = () => page.locator("div.fixed");

/** Var Björn står på måndagen. */
const bjornsBil = async () => {
  for (const bil of ["BT13/14", "BT24/26"]) {
    const text = (await page.locator(`tbody tr[data-row="${bil}"]`).allInnerTexts()).join(" ");
    if (text.includes("Björn Westman")) return bil;
  }
  return "(ingen)";
};

async function pick(select: ReturnType<typeof page.locator>, needle: string) {
  const texts = await select.locator("option").allInnerTexts();
  const i = texts.findIndex((t) => t.includes(needle));
  if (i < 0) throw new Error(`hittade inte "${needle}" bland: ${texts.join(" | ")}`);
  await select.selectOption({ index: i });
}

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${weekQuery()}`, { waitUntil: "networkidle" });
console.log("  Björn står på:", await bjornsBil());

/* ---- Koppla Björn till en andra bil ---- */
await page.getByRole("button", { name: /Bas-schema/ }).click();
await page.waitForTimeout(900);
await pick(dialog().locator("select").nth(0), "BT24/26");
await pick(dialog().locator("select").nth(1), "Björn Westman");
await dialog().getByRole("button", { name: "Koppla", exact: true }).click();
await page.waitForTimeout(1800);

const rader = await dialog().locator("table tbody tr", { hasText: "Björn Westman" }).allInnerTexts();
console.log("  Björns kopplingar:", rader.map((r) => r.replace(/\s+/g, " ")).join(" | "));
check("båda kopplingarna syns", rader.length === 2);
check("ordningen numreras 1 och 2", rader.some((r) => /\b1\b/.test(r)) && rader.some((r) => /\b2\b/.test(r)));

const flyttUpp = dialog()
  .locator("tr", { hasText: "Björn Westman" })
  .getByRole("button", { name: "Flytta upp" });
check("det går att flytta upp den andra", (await flyttUpp.count()) === 2);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(800);

/* ---- Fyll veckan två gånger: samma bil båda gångerna ---- */
await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(3000);
const forsta = await bjornsBil();
await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(3000);
const andra = await bjornsBil();
console.log(`  Fyll veckan: ${forsta} → ${andra}`);
check("samma bil båda gångerna", forsta === andra && forsta !== "(ingen)");

/* Ingen varning här, och det är meningen: en ny koppling läggs sist i
   personens ordning, så de två har olika prioritet från början. Varningen
   gäller kopplingar som ligger på samma prioritet — data som fanns innan
   ordningen gick att sätta. Det fallet täcks av enhetstesterna. */
// Beskeden ligger under knappraden, med en egen krok — inte i raden.
const rapport = await page.locator("[data-notiser]").innerText();
check("ingen tvetydighet när ordningen är satt", !rapport.includes("kopplad till flera bilar"));
console.log("  rapport:", rapport.split("\n").find((l) => l.includes("pass utlagda")) ?? "(saknas)");

/* ---- Byt ordning: personen ska flytta till den andra bilen ---- */
await page.getByRole("button", { name: /Bas-schema/ }).click();
await page.waitForTimeout(900);
await dialog()
  .locator("tr", { hasText: "Björn Westman" })
  .getByRole("button", { name: "Flytta upp" })
  .nth(1)
  .click();
await page.waitForTimeout(1800);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(800);

await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(3000);
const efterByte = await bjornsBil();
console.log(`  efter ändrad ordning: ${efterByte}`);
check("ordningen styr vilken bil som vinner", efterByte !== forsta && efterByte !== "(ingen)");

await page.screenshot({ path: "/tmp/basordning.png" });
await browser.close();
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
