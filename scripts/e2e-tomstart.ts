/**
 * Provar vägen en ny installation tar: logga in, skapa en tavla, lägg
 * in stationsort, personal och fordon, välj bemanning, koppla
 * bas-schemat och begär veckans schema.
 *
 * Personalen läggs in för hand här och saknar därför TransPA-koppling.
 * Då finns inga arbetsdagar, och det ska sägas rakt ut i stället för
 * att veckan tyst blir tom — det är just det testet kontrollerar.
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

/** Påhittad personal — bara för att ha någon att lägga ut. */
const CREW = [
  ["Björn", "Westman", "2262"],
  ["Roger", "Bergström", "2263"],
  ["Elin", "Karlsson", "2264"],
];

/** Väljer i en select på delsträng i optionstexten. */
async function pick(select: ReturnType<typeof page.locator>, needle: string) {
  const texts = await select.locator("option").allInnerTexts();
  const i = texts.findIndex((t) => t.includes(needle));
  if (i < 0) throw new Error(`hittade inte "${needle}" bland: ${texts.join(" | ")}`);
  await select.selectOption({ index: i });
}

await signIn(page, base);
check("loggar in", !page.url().includes("logga-in"));

const start = (await page.textContent("body")) ?? "";

/* Skriptet provar en *ny* installation, och det kräver en databas utan
   tavlor. Körs det mot demo-seedens data står formuläret inte öppet, och
   felet blev då en trettio sekunders timeout på en fältväljare — som
   säger att fältet saknas, inte att förutsättningen är fel. Säg det i
   stället, direkt. */
if (!start.includes("Inga tavlor ännu")) {
  console.log("✗ kräver en databas utan tavlor.");
  console.log("  Kör:  rm -rf .pgdata && npx tsx scripts/seed-tom.ts");
  await browser.close();
  process.exit(1);
}
check("tom databas erbjuder att skapa tavla", true);
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
for (const [first, last, number] of CREW) {
  await page.fill('label:has-text("Förnamn") input', first);
  await page.fill('label:has-text("Efternamn") input', last);
  await page.fill('label:has-text("Anst.nr") input', number);
  await page.selectOption('div.rounded label:has-text("Stationsort") select', { label: "Nybro" });
  await page.click('div.rounded.border button:text("Lägg till")');
  await page.waitForFunction(
    (name) => document.body.innerText.includes(name),
    `${first} ${last}`,
    { timeout: 15_000 },
  );
}
check("personal går att lägga in", true);

await page.click('button:text("Fordon")');
await page.fill('input[placeholder="BT08"]', "BT13");
await page.click('div.rounded.border button:text("Lägg till")');
await page.waitForFunction(
  () => [...document.querySelectorAll("td input")].some((i) => (i as HTMLInputElement).value === "BT13"),
  { timeout: 15_000 },
);
check("fordon går att lägga in", true);

/* ---- Bemanning: hela orten på en gång ---- */
await page.goto(`${base}/tavla/fjarr-nybro`, { waitUntil: "networkidle" });
check("tavlan är kvar efter grunddatan", ((await page.textContent("body")) ?? "").includes("Fjärr Nybro"));

await page.click('button:text("+ lägg till")');
await page.waitForSelector('text=Lägg till personal');
await page.selectOption('label:has-text("Stationsort") select', { label: "Nybro" });
await page.click('button:has-text("Välj alla")');
await page.click('button:text-is("Spara")');
await page.waitForTimeout(1500);
const crewText = await page.locator("aside").innerText();
check("hela orten blev bemanning", CREW.every((p) => crewText.includes(p[0] + " " + p[1])));

/* ---- Bas-schema och veckans schema ---- */
await page.getByRole("button", { name: "Bas-schema" }).click();
await page.waitForTimeout(500);
const dialog = page.locator("div.fixed");
await dialog.locator("select").nth(0).selectOption({ label: "Bil 1" });
await pick(dialog.locator("select").nth(1), "Björn Westman");
// "Koppla" matchar även "Koppla bort" i bemanningen — därför exakt, i rutan.
await dialog.getByRole("button", { name: "Koppla", exact: true }).click();
await page.waitForTimeout(1500);
check(
  "bas-schemat kopplar person till bil",
  (await dialog.locator("table tbody tr").allInnerTexts()).some(
    (t) => t.includes("Bil 1") && t.includes("Björn Westman"),
  ),
);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(600);

/* Handinlagd personal har ingen TransPA-koppling. Hämtningen ska säga
   det med namn i stället för att se ut som en tom vecka. */
await page.getByRole("button", { name: /Hämta schema/ }).click();
await page.waitForTimeout(4000);
// Beskeden ligger under knappraden, med en egen krok — inte i raden.
const fetchNote = await page.locator("[data-notiser]").innerText();
check(
  "hämtningen säger att ingen är kopplad till TransPA",
  fetchNote.includes("utan TransPA-koppling") || fetchNote.includes("Ingen är kopplad"),
);

await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(3000);
const row = await page.locator('tbody tr:has(th:text-is("Bil 1"))').innerText();
check("utan hämtat schema läggs inga pass ut", !row.includes("Björn Westman"));

await browser.close();

for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
