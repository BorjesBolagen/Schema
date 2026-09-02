/**
 * "Rensa veckan" — knappen som tömmer tavlan på pass för den vecka man
 * tittar på.
 *
 * Det som ska bevisas: att bekräftelsen räknar rätt, att avbryt lämnar
 * veckan i fred, att rensningen bara träffar den veckan, och att
 * underlaget överlever så att Fyll veckan kan lägga ut den igen.
 */
import { chromium } from "playwright-core";
import { signIn, nextWeekQuery, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3270";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

const veckan = `${weekQuery()}`;
const grannen = `${nextWeekQuery()}`;
/* Passen är de dragbara spannen. Skiftikonen ☀️/🌙 bär också title,
   så den selektorn räknar tomma celler med. */
const passIRutnatet = async () => await page.locator("tbody span.cursor-grab").count();

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${veckan}`, { waitUntil: "networkidle" });

const fore = await passIRutnatet();
check("veckan har pass att rensa", fore > 0);
console.log(`  v.34 före: ${fore} pass`);

await page.goto(`${base}/tavla/fjarr-nybro${grannen}`, { waitUntil: "networkidle" });
const grannenFore = await passIRutnatet();
console.log(`  v.35 före: ${grannenFore} pass`);

await page.goto(`${base}/tavla/fjarr-nybro${veckan}`, { waitUntil: "networkidle" });

/* ---- Bekräftelsen ---- */
await page.getByRole("button", { name: "Rensa veckan" }).click();
await page.waitForTimeout(1200);
/* Kroken sitter på verktygsraden, inte på en layoutklass. Skripten
   hakade förut i "div.mb-3" och gick sönder när marginalen ändrades —
   ett rött som inte betydde att något var trasigt. */
const text = await page.locator("[data-verktygsrad]").innerText();
check("bekräftelsen räknar passen", /Tar bort \d+ pass/.test(text));
/* Spannet nämner två datum och ett årtal. Månaden skrivs bara en gång
   när veckan ligger inom en månad ("17–23 aug 2026") och två gånger när
   den korsar ett månadsskifte ("31 aug–6 sep 2026") — båda ska godtas. */
check("bekräftelsen nämner datumspannet", /\d+( \w+)?–\d+ \w+ \d{4}/.test(text));
console.log("  bekräftelse:", text.split("\n").find((l) => l.includes("Tar bort")) ?? "(saknas)");

/* ---- Avbryt ska inte röra något ---- */
await page.getByRole("button", { name: "Avbryt" }).click();
await page.waitForTimeout(600);
check("avbryt lämnar veckan i fred", (await passIRutnatet()) === fore);

/* ---- Rensa på riktigt ---- */
await page.getByRole("button", { name: "Rensa veckan" }).click();
await page.waitForTimeout(1200);
await page.locator("button.bg-\\(--color-danger\\)", { hasText: "Rensa veckan" }).click();
await page.waitForTimeout(2500);

check("veckan är tom efteråt", (await passIRutnatet()) === 0);
const kvitto = await page.locator("[data-verktygsrad]").innerText();
check("kvittot säger hur många som togs bort", /\d+ pass borttagna/.test(kvitto));
console.log("  kvitto:", kvitto.split("\n").find((l) => l.includes("borttagna")) ?? "(saknas)");

/* ---- Grannveckan ska vara orörd ---- */
await page.goto(`${base}/tavla/fjarr-nybro${grannen}`, { waitUntil: "networkidle" });
check("grannveckan är orörd", (await passIRutnatet()) === grannenFore);

/* ---- Underlaget överlever: Fyll veckan lägger ut igen ---- */
await page.goto(`${base}/tavla/fjarr-nybro${veckan}`, { waitUntil: "networkidle" });
const bemanning = await page.locator("aside").innerText();
check("bemanningen finns kvar", bemanning.includes("Elin Karlsson"));

await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(3000);
const efterFyll = await passIRutnatet();
check("Fyll veckan lägger ut veckan igen", efterFyll > 0);
console.log(`  v.34 efter Fyll veckan: ${efterFyll} pass`);

/* ---- Tom vecka ska säga det, inte fråga ---- */
await page.getByRole("button", { name: "Rensa veckan" }).click();
await page.waitForTimeout(1200);
await page.locator("button.bg-\\(--color-danger\\)", { hasText: "Rensa veckan" }).click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Rensa veckan" }).click();
await page.waitForTimeout(1200);
check(
  "tom vecka bekräftas inte, den säger bara ifrån",
  (await page.locator("[data-verktygsrad]").innerText()).includes("redan tom"),
);

await browser.close();
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
