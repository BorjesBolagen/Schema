/**
 * Riktningen upp/ner på en linjebil.
 *
 * En linje körs av två bilar som möts på vägen: en upp och en ner samma
 * natt, på samma rad. Det som ska bevisas är att riktningen syns där,
 * att den inte syns på rader som inte är linjebilar, och att biltypen
 * går att ändra i tavelredigeraren.
 */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3280";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

/* En bil spänner en tabellrad per skift, så den väljs på data-row
   och inte på rubrikcellen. */
const rad = (label: string) => page.locator(`tbody tr[data-row="${label}"]`);

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro?ar=2026&vecka=34`, { waitUntil: "networkidle" });

/* Riktningen känns igen på sin etikett, inte på sin glyf: glyfen är
   ett designval som får ändras utan att testet blir rött. */
const riktningar = (label: string) => rad(label).locator("span[aria-label='Upp'], span[aria-label='Ner']");

/* ---- Linjebilen visar riktning ---- */
const linjen = (await rad("BT08/09").allInnerTexts()).join(" ");
console.log("  BT08/09:", linjen.replace(/\s+/g, " ").slice(0, 150));
check("linjebilen visar riktning", (await riktningar("BT08/09").count()) > 0);
check(
  "både upp och ner förekommer",
  (await rad("BT08/09").locator("span[aria-label='Upp']").count()) > 0 &&
    (await rad("BT08/09").locator("span[aria-label='Ner']").count()) > 0,
);

/* ---- En rad som inte är linjebil visar ingen riktning ---- */
const annan = (await rad("BT13/14").allInnerTexts()).join(" ");
console.log("  BT13/14:", annan.replace(/\s+/g, " ").slice(0, 110));
check("rad som inte är linjebil visar ingen riktning", (await riktningar("BT13/14").count()) === 0);

/* ---- Riktningen har en läsbar förklaring ---- */
const pil = rad("BT08/09").locator("span[title*='ur passets benämning']").first();
check("pilen förklarar varifrån den kommer", (await pil.count()) > 0);
if ((await pil.count()) > 0) console.log("  förklaring:", await pil.getAttribute("title"));

/* ---- Biltypen går att ändra, och ändringen slår igenom ---- */
await page.getByRole("button", { name: "⚙ Tavla" }).click();
await page.waitForTimeout(600);

const rowLi = page.locator("li[data-row-id]").first();
const kindSelect = rowLi.locator("select").nth(2);
check("biltypen går att välja i redigeraren", (await kindSelect.count()) === 1);
check("linjebil är förvalt på linjeraden", (await kindSelect.inputValue()) === "linjebil");

await kindSelect.selectOption("bytesbil");
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(1200);

check("bytesbil visar ingen riktning", (await riktningar("BT08/09").count()) === 0);

/* ---- Och tillbaka igen ---- */
await page.getByRole("button", { name: "⚙ Tavla" }).click();
await page.waitForTimeout(600);
await page.locator("li[data-row-id]").first().locator("select").nth(2).selectOption("linjebil");
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Klar" }).click();
await page.waitForTimeout(1200);
check("riktningen kommer tillbaka", (await riktningar("BT08/09").count()) > 0);

/* Tydligheten är hela poängen med markeringen: två saker ska skilja
   upp från ner, så den håller även i svartvit utskrift. */
const upp = rad("BT08/09").locator("span[aria-label='Upp']").first();
const ner = rad("BT08/09").locator("span[aria-label='Ner']").first();
check("upp och ner har olika glyf", (await upp.innerText()) !== (await ner.innerText()));
check(
  "upp och ner har olika färg",
  (await upp.evaluate((el) => getComputedStyle(el).backgroundColor)) !==
    (await ner.evaluate((el) => getComputedStyle(el).backgroundColor)),
);

await page.screenshot({ path: "/tmp/riktning.png" });
await browser.close();
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
