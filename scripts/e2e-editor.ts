/**
 * Hela flödet en trafikansvarig ska klara utan utvecklare:
 * bygga om tavlans layout, koppla en person till en bil i bas-schemat
 * och se att veckan bemannas ur hens hämtade pass.
 */
import { chromium } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3212";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${weekQuery()}`, { waitUntil: "networkidle" });

const headers = async () =>
  (await page.locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const rowLabels = async () =>
  (await page.locator("tbody th[scope=row]").allInnerTexts()).map((t) => t.trim());
const unplaced = async () => (await page.locator("aside").innerText()).match(/EJ UTLAGDA \((\d+)\)/)?.[1] ?? "0";
const check = (name: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${name}`);

/** Väljer i en select på delsträng i optionstexten. */
async function pick(select: ReturnType<typeof page.locator>, needle: string) {
  const texts = await select.locator("option").allInnerTexts();
  const i = texts.findIndex((t) => t.includes(needle));
  if (i < 0) throw new Error(`hittade inte "${needle}" bland: ${texts.join(" | ")}`);
  await select.selectOption({ index: i });
}

console.log("Före:", (await headers()).join(", "));
console.log("Rader:", (await rowLabels()).join(", "), "| ej utlagda:", await unplaced());

/* ---- 1. Bygg om layouten ---- */
await page.getByRole("button", { name: "⚙ Tavla" }).click();
await page.waitForTimeout(400);

const firstRowInput = page.locator("li[data-row-id] input").first();
await firstRowInput.fill("Stockholm 1");
await firstRowInput.blur();
await page.waitForTimeout(900);

await page.getByPlaceholder("Ny rad, t.ex. BT57/58…").fill("BT57/58");
await page.getByRole("button", { name: "Lägg till rad" }).click();
await page.waitForTimeout(900);

await page.locator('button:text-is("F")').first().click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Bilnummer" }).click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(800);

const after = await rowLabels();
const cols = await headers();
const gridText = await page.locator("tbody").innerText();
console.log("\nEfter ombyggnad:");
check("raden omdöpt till 'Stockholm 1'", after.includes("Stockholm 1"));
check("ny rad BT57/58 finns", after.includes("BT57/58"));
check("fredagen borta", !cols.some((c) => c.startsWith("Fre")));
check("bilnumren dolda", !/^BT08$/m.test(gridText));

/* ---- 2. Koppla Max till den nya raden ---- */
await page.getByRole("button", { name: "Bas-schema" }).click();
await page.waitForTimeout(500);
const dialog = page.locator("div.fixed");
await pick(dialog.locator("select").nth(0), "BT57/58");
await pick(dialog.locator("select").nth(1), "Max Kellgren");
// "Koppla" matchar även "Koppla bort" i bemanningen — därför exakt, i rutan.
await dialog.getByRole("button", { name: "Koppla", exact: true }).click();
await page.waitForTimeout(1200);
const coupled = (await dialog.locator("table tbody tr").allInnerTexts()).some(
  (t) => t.includes("BT57/58") && t.includes("Max Kellgren"),
);
console.log("\nBas-schema:");
check("Max kopplad till BT57/58", coupled);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(600);

/* ---- 3. Fyll veckan ---- */
await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(2500);
const newRow = await page.locator('tbody tr:has(th:text-is("BT57/58"))').innerText();
console.log("\nEfter Fyll veckan:");
check("BT57/58 bemannad av Max", newRow.includes("Max Kellgren"));
check("ingen kvar som ej utlagd", (await unplaced()) === "0");
console.log("    BT57/58:", newRow.replace(/\n+/g, " "));

await page.screenshot({ path: "/tmp/editor.png" });
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
