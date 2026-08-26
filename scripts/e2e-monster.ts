/**
 * Mönsterredigeraren i en riktig webbläsare.
 *
 * Finns särskilt för förslagspanelen: den anropar TransPA, och i en
 * miljö utan nätåtkomst dit ska felvägen synas i gränssnittet i stället
 * för att panelen står tom eller kraschar.
 */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3210";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro?ar=2026&vecka=35`, { waitUntil: "networkidle" });

const opener = page.getByRole("button", { name: /arbetsmönster/i }).first();
console.log("öppnarknapp finns:", (await opener.count()) > 0);
await opener.click();
await page.waitForTimeout(600);

console.log("panel öppnad:", (await page.getByRole("heading", { name: "Arbetsmönster" }).count()) > 0);

const suggest = page.getByRole("button", { name: /Föreslå ur turhistoriken/i });
console.log("förslagsknapp finns:", (await suggest.count()) > 0);

const body = await page.locator("body").innerText();
console.log("lovar inte längre TransPA-hämtning:", !/tills arbetsdagarna kan hämtas/i.test(body));

await suggest.click();
await page.waitForTimeout(5000);
const after = await page.locator("body").innerText();
const lines = after.split("\n").map((l) => l.trim());
const note = lines.find((l) => /^(Ingen i bemanningen|Kunde inte läsa|\d+ turer på)/.test(l));
console.log("sammanfattning:", note ?? "(ingen — åtgärden svarade inte)");

/* Det som var trasigt: sa panelen ingenting om den valda personen såg
   det ut som att knappen inte gjorde något alls. */
const perPerson = lines.find((l) => /^(Inga turer för den här personen|Kör |Bara \d+ vecka|Turerna följer)/.test(l));
console.log("besked om den valda personen:", perPerson ?? "(INGET — det är felet)");
console.log("knappen är klickbar igen:", await suggest.isEnabled());

console.log("JS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
