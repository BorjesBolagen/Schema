/** Knappen "Hämta schema" på tavlan. */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3211";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const ok = (l: string, p: boolean) => console.log(`${p ? "✓" : "✗"} ${l}`);

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro?ar=2026&vecka=35`, { waitUntil: "networkidle" });

// Knapparna är numrerade i den ordning arbetet görs.
const knapp = page.getByRole("button", { name: /Hämta schema/ }).first();
ok("knappen finns på tavlan", (await knapp.count()) > 0);

await knapp.click();
await page.waitForTimeout(9000);

const svar = (await page.locator("main").innerText())
  .split("\n")
  .find((l) => /pass för \d+ av|Kunde inte hämta|utan TransPA-koppling/.test(l));
console.log("   svar:", svar ?? "(inget svar syns)");
ok("åtgärden svarade", svar !== undefined);
ok("sidan står kvar", (await page.locator("table").count()) > 0);

console.log("JS-fel:", errors.length ? errors.slice(0, 2) : "inga");
await browser.close();
