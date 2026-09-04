/**
 * Läsbehörighet: board_member.role = 'viewer'.
 *
 * Rollen fick betydelse i säkerhetsomgången — canEditBoard läser den, och
 * boardForAction kastar för den som bara får se. Men ingenting hade kört
 * den halvan från utsidan, och en spärr ingen kört är en spärr man
 * hoppas på. Det här provet kör den genom webbläsaren, på samma väg en
 * planerare går.
 *
 * Två sidor, annars kan det gå igenom av fel skäl: samma knapp trycks
 * först som administratör och ska då lämna en kvittens, sedan som läsare
 * och ska då inte göra det. Utan admin-halvan skulle provet vara grönt
 * även om knappen slutat fungera för alla.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3410";
const vecka = weekQuery();
const tavla = `${base}/tavla/fjarr-nybro${vecka}`;

const läsare = {
  email: process.env.SEED_VIEWER_EMAIL ?? "lasare@example.se",
  password: process.env.SEED_VIEWER_PASSWORD ?? "schema-demo-2026",
};

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

const browser: Browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});

/** Egen kontext per konto — sessionskakan får inte följa med över. */
async function som(uppgifter?: { email: string; password: string }) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  /* Både pageerror och console: ett kastat server-action landar i
     React:s felgräns och rapporteras som ett konsolfel, inte som ett
     obehandlat undantag. */
  const fel: string[] = [];
  page.on("pageerror", (e) => fel.push(String(e)));
  page.on("console", (m) => m.type() === "error" && fel.push(m.text()));
  await signIn(page, base, uppgifter);
  return { page, fel, close: () => context.close() };
}

/** Trycker "Fyll veckan" och lämnar tillbaka notisraden efteråt. */
async function fyllVeckan(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Fyll veckan/ }).click();
  await page.waitForTimeout(3000);
  const notiser = page.locator("[data-notiser]");
  return (await notiser.count()) ? await notiser.innerText() : "";
}

/* ---- Administratör: knappen ska ge en kvittens ---- */
{
  const { page, close } = await som();
  await page.goto(tavla, { waitUntil: "networkidle" });
  const notis = await fyllVeckan(page);
  console.log("  admin:", notis.replace(/\s+/g, " ").slice(0, 140) || "(ingen notis)");
  check("administratören får fylla veckan", /utlagda/.test(notis));
  await close();
}

/* ---- Läsare: ser tavlan men får inte ändra den ---- */
{
  const { page, fel, close } = await som(läsare);

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const start = await page.locator("body").innerText();
  check("läsaren ser tavlan på startsidan", /Fjärr|fjarr-nybro/i.test(start));

  await page.goto(tavla, { waitUntil: "networkidle" });
  const grid = await page.locator("body").innerText();
  check("läsaren når veckovyn", /Vecka/.test(grid) && !page.url().includes("logga-in"));

  const notis = await fyllVeckan(page);
  console.log("  läsare:", notis.replace(/\s+/g, " ").slice(0, 140) || "(ingen notis)");
  check("läsaren får ingen kvittens på att veckan fyllts", !/utlagda/.test(notis));
  check(
    "servern avvisade skrivningen med skälet",
    fel.some((f) => /läsbehörighet/i.test(f)),
  );
  const skäl = fel.find((f) => /läsbehörighet/i.test(f)) ?? fel[0] ?? "";
  if (skäl) console.log("  serverns svar:", skäl.replace(/\s+/g, " ").slice(0, 150));

  await close();
}

await browser.close();
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
