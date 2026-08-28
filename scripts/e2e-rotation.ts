/**
 * Rullande scheman.
 *
 * Tre former ska klaras: olika bilar olika dagar, olika bilar olika
 * veckor, och de två kombinerade i en cykel. Det här skriptet provar de
 * två första i gränssnittet — den tredje är samma maskineri och täcks av
 * enhetstesterna.
 */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3360";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);
const dialog = () => page.locator("div.fixed");

/** Vilken bil Björn står på en viss veckodag (0-indexerad kolumn). */
async function bjornsBil(kolumn: number): Promise<string> {
  for (const bil of ["BT13/14", "BT24/26"]) {
    /* Bilnamnet står i ett th, inte ett td, så td-listan börjar på
       linjen: linje(0), skift(1), sedan dagarna. */
    const celler = page.locator(`tbody tr[data-row="${bil}"][data-shift="day"] td`);
    const text = await celler.nth(2 + kolumn).innerText();
    if (text.includes("Björn Westman")) return bil;
  }
  return "—";
}

async function pick(select: ReturnType<typeof page.locator>, needle: string) {
  const texts = await select.locator("option").allInnerTexts();
  const i = texts.findIndex((t) => t.includes(needle));
  if (i < 0) throw new Error(`hittade inte "${needle}" bland: ${texts.join(" | ")}`);
  await select.selectOption({ index: i });
}

const fyll = async () => {
  await page.getByRole("button", { name: /Fyll veckan/ }).click();
  await page.waitForTimeout(3000);
};

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro?ar=2026&vecka=34`, { waitUntil: "networkidle" });

/* ---- Koppla Björn till en andra bil ---- */
await page.getByRole("button", { name: /Bas-schema/ }).click();
await page.waitForTimeout(900);
await pick(dialog().locator("select").nth(0), "BT24/26");
await pick(dialog().locator("select").nth(1), "Björn Westman");
await dialog().getByRole("button", { name: "Koppla", exact: true }).click();
await page.waitForTimeout(1800);

const rad = (bil: string) => dialog().locator("tr", { hasText: "Björn Westman" }).filter({ hasText: bil });
check("regeln visas som 'alltid' från början", (await rad("BT13/14").innerText()).includes("alltid"));

/* ---- 1. Olika bilar olika dagar ---- */
await rad("BT13/14").getByRole("button", { name: /alltid/ }).click();
await page.waitForTimeout(500);
for (const d of ["Mån", "Ons"]) await dialog().getByRole("button", { name: d, exact: true }).click();
await dialog().getByRole("button", { name: "Spara" }).click();
await page.waitForTimeout(1800);

await rad("BT24/26").getByRole("button", { name: /alltid/ }).click();
await page.waitForTimeout(500);
for (const d of ["Tis", "Tors"]) await dialog().getByRole("button", { name: d, exact: true }).click();
await dialog().getByRole("button", { name: "Spara" }).click();
await page.waitForTimeout(1800);

const regler = (await dialog().locator("tr", { hasText: "Björn Westman" }).allInnerTexts()).join(" | ");
console.log("  regler:", regler.replace(/\s+/g, " "));
check("veckodagarna syns i listan", /mån, ons/.test(regler) && /tis, tors/.test(regler));

await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(800);
await fyll();

const veckan = [await bjornsBil(0), await bjornsBil(1), await bjornsBil(2), await bjornsBil(3)];
console.log("  mån–tors:", veckan.join(" · "));
check("måndagen följer mån/ons-regeln", veckan[0] === "BT13/14");
check("tisdag och torsdag följer tis/tors-regeln", veckan[1] === "BT24/26" && veckan[3] === "BT24/26");
/* Onsdagen är tom för att Björn inte jobbar då i demot, inte för att
   regeln inte gällde. Regeln kan bara lägga ut de dagar personen jobbar
   — det är hela poängen med att dagarna kommer från TransPA. */
check("onsdagen är tom eftersom han inte jobbar då", veckan[2] === "—");

/* ---- 2. Olika bilar olika veckor ---- */
await page.getByRole("button", { name: "⚙ Tavla" }).click();
await page.waitForTimeout(700);
await page.locator("select").filter({ hasText: "Ingen rotation" }).selectOption("2");
await page.waitForTimeout(1500);
check("cykelval sparades", (await page.locator("body").innerText()).includes("cykelvecka"));
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(800);

await page.getByRole("button", { name: /Bas-schema/ }).click();
await page.waitForTimeout(900);
await rad("BT13/14").getByRole("button", { name: /mån, ons/ }).click();
await page.waitForTimeout(500);
const cykelrad = dialog().locator("div", { hasText: "Cykelvecka" }).last();
check("cykelveckor går att välja när tavlan har rotation", (await cykelrad.count()) > 0);
await page.getByRole("button", { name: "Avbryt" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Klar" }).click();

await page.screenshot({ path: "/tmp/rotation.png" });
await browser.close();
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
