/**
 * Vad en planerare får och inte får.
 *
 * Rollen är den vanligaste appen har — en trafikansvarig som bygger och
 * justerar sin egen tavla — och den enda som aldrig hade körts. Allt
 * hade provats som administratör, och administratören går förbi varje
 * medlemskontroll: en spärr som bara gäller planerare kunde alltså vara
 * hur trasig som helst utan att något blev rött.
 *
 * Gränsen som prövas: planeraren får bygga, justera och riva sina egna
 * tavlor och röra grunddata. Hen får inte lägga upp konton, och ska inte
 * se kopplingen till TransPA eller till databasen — varken som länk
 * eller genom att skriva adressen själv.
 */
import { chromium, type Page } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3420";
const planerare = {
  email: process.env.SEED_PLANNER_EMAIL ?? "planerare@example.se",
  password: process.env.SEED_PLANNER_PASSWORD ?? "schema-demo-2026",
};

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page: Page = await context.newPage();
const fel: string[] = [];
page.on("pageerror", (e) => fel.push(String(e)));
page.on("console", (m) => m.type() === "error" && fel.push(m.text()));

await signIn(page, base, planerare);

/* ---- Startsidan: vad som syns ---- */
await page.goto(`${base}/`, { waitUntil: "networkidle" });
const start = await page.locator("body").innerText();
check("planeraren ser sin tavla", /Fjärr/.test(start));
check("ser Grunddata", start.includes("Grunddata"));
check("ser INTE TransPA-anslutning", !start.includes("TransPA-anslutning"));
check("ser INTE Databaskoppling", !start.includes("Databaskoppling"));
check("ser INTE Användare", !/\bAnvändare\b/.test(start));

/* ---- Adresserna direkt: länken borta räcker inte ---- */
for (const [väg, namn] of [
  ["/transpa", "TransPA"],
  ["/db-health", "Databaskoppling"],
  ["/anvandare", "Användare"],
] as const) {
  await page.goto(`${base}${väg}`, { waitUntil: "networkidle" });
  check(`${namn} nås inte genom att skriva adressen`, new URL(page.url()).pathname !== väg);
}

/* ---- Grunddata: öppen, och går att skriva i ---- */
await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });
check("Grunddata öppnas", (await page.locator("h1").innerText()).includes("Grunddata"));

/* ---- Bygga en egen tavla ---- */
const namn = `Planerartavla ${Date.now().toString().slice(-5)}`;
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Ny tavla" }).click();
await page.waitForTimeout(500);
await page.locator('input[placeholder="Fjärr Nybro/Hultsfred"]').fill(namn);
/* Formuläret skickar vidare till den nya tavlan självt — router.push i
   NewBoardForm — så det är den navigeringen som säger att det gick. */
await Promise.all([
  page.waitForURL("**/tavla/**", { timeout: 60_000 }),
  page.getByRole("button", { name: "Skapa tavla" }).click(),
]);
await page.waitForLoadState("networkidle");
const egenTavla = page.url().split("?")[0];
check("planeraren fick skapa en tavla", /\/tavla\//.test(egenTavla));

/* ---- Justera den ---- */
await page.goto(`${egenTavla}${weekQuery()}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Tavla" }).first().click();
await page.waitForTimeout(1500);
check("tavelredigeraren öppnas", /Grupprubriker|Rader/i.test(await page.locator("body").innerText()));

/* Radens namnfält är det första fritextfältet i redigerarens radlista.
   Det sparar på blur, inte på en knapp. */
const radfält = page.locator('input[placeholder="linje/ort"]').first();
const namnfält = radfält.locator("xpath=preceding-sibling::input[1]");
await namnfält.fill("Egen rad 1");
await namnfält.blur();
await page.waitForTimeout(2500);
await page.goto(`${egenTavla}${weekQuery()}`, { waitUntil: "networkidle" });
check("radändringen sparades", (await page.locator("body").innerText()).includes("Egen rad 1"));

/* ---- Fylla veckan på sin egen tavla ---- */
await page.goto(`${egenTavla}${weekQuery()}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(3000);
const notiser = page.locator("[data-notiser]");
const notis = (await notiser.count()) ? await notiser.innerText() : "";
check("planeraren får fylla veckan", /utlagda/.test(notis));
check(
  "ingen behörighetsvägran längs vägen",
  !fel.some((f) => /läsbehörighet|inte tillgång/i.test(f)),
);

/* ---- Riva sin egen tavla ---- */
await page.goto(`${base}/`, { waitUntil: "networkidle" });
const rivKort = page.locator("li", { hasText: namn }).first();
const rivknapp = rivKort.getByRole("button", { name: `Ta bort ${namn}` });
check("borttagningsknappen finns på den egna tavlan", (await rivknapp.count()) > 0);
await rivknapp.click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Ta bort tavlan" }).click();
await page.waitForTimeout(3000);
await page.goto(`${base}/`, { waitUntil: "networkidle" });
check("tavlan är borta", !(await page.locator("body").innerText()).includes(namn));

if (fel.length) console.log("  fel på vägen:", fel.slice(0, 2).map((f) => f.replace(/\s+/g, " ").slice(0, 120)));
await browser.close();
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
