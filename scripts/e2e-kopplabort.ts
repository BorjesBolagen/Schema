/**
 * Koppla bort en person från en tavla, och riktningens tydlighet.
 *
 * Bortkopplingen ska ta bemanning och bas-schema men lämna passen —
 * ett pass är planerat arbete och ska inte försvinna som bieffekt av
 * att någon städar en lista. Och dragytan får inte krympa: hela kortet
 * ska fortfarande gå att dra ut på en rad.
 */
import { chromium } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3300";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

const aside = () => page.locator("aside");
const kort = (namn: string) => aside().locator("li", { hasText: namn }).first();

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${weekQuery()}`, { waitUntil: "networkidle" });

check("personen finns i bemanningen", (await aside().innerText()).includes("Roger Bergström"));

/* ---- Knappen finns och förklarar sig ---- */
const knapp = kort("Roger Bergström").getByRole("button", { name: /Koppla bort/ });
check("bortkopplingsknappen finns på kortet", (await knapp.count()) > 0);

await knapp.click();
await page.waitForTimeout(1200);
const bekraftelse = await kort("Roger Bergström").innerText();
console.log("  bekräftelse:", bekraftelse.replace(/\s+/g, " ").slice(0, 160));
check("bekräftelsen säger vad som händer", bekraftelse.includes("Kopplas bort från tavlan"));
check(
  "bekräftelsen nämner bas-schemat eller att passen står kvar",
  /bas-schemarad|pass står kvar|finns kvar i registret/.test(bekraftelse),
);

/* ---- Avbryt lämnar allt i fred ---- */
await kort("Roger Bergström").getByRole("button", { name: "Avbryt" }).click();
await page.waitForTimeout(600);
check("avbryt lämnar personen kvar", (await aside().innerText()).includes("Roger Bergström"));

/* ---- Koppla bort på riktigt ---- */
const passFore = await page.locator("tbody span.cursor-grab", { hasText: "Roger" }).count();
await kort("Roger Bergström").getByRole("button", { name: /Koppla bort/ }).click();
await page.waitForTimeout(1200);
await kort("Roger Bergström").getByRole("button", { name: "Koppla bort" }).click();
await page.waitForTimeout(2500);

check("personen är borta ur bemanningen", !(await aside().innerText()).includes("Roger Bergström"));
const passEfter = await page.locator("tbody span.cursor-grab", { hasText: "Roger" }).count();
check("de utlagda passen står kvar", passEfter === passFore && passFore > 0);
console.log(`  pass före: ${passFore}, efter: ${passEfter}`);

/* ---- Bas-schemat ska vara borta ---- */
await page.getByRole("button", { name: /Bas-schema/ }).click();
await page.waitForTimeout(900);
const dialog = page.locator("div.fixed");
check(
  "bas-schemakopplingen är borttagen",
  !(await dialog.innerText()).includes("Roger Bergström"),
);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(600);

/* ---- Riktningen ska vara läsbar ---- */
const rad = page.locator('tbody tr[data-row="BT08/09"]');
const upp = rad.locator("span[aria-label='Upp']").first();
const ner = rad.locator("span[aria-label='Ner']").first();
check("riktningen upp finns med egen etikett", (await upp.count()) > 0);
check("riktningen ner finns med egen etikett", (await ner.count()) > 0);
check("upp och ner har olika glyf", (await upp.innerText()) !== (await ner.innerText()));
const uppBg = await upp.evaluate((el) => getComputedStyle(el).backgroundColor);
const nerBg = await ner.evaluate((el) => getComputedStyle(el).backgroundColor);
check("upp och ner har olika färg", uppBg !== nerBg);
console.log(`  upp: "${await upp.innerText()}" ${uppBg} · ner: "${await ner.innerText()}" ${nerBg}`);

await page.screenshot({ path: "/tmp/kopplabort.png" });
await browser.close();
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
