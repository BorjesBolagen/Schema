/** Passuppslaget: finns formuläret, och svarar åtgärden? */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3211";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const ok = (l: string, p: boolean) => console.log(`${p ? "✓" : "✗"} ${l}`);

await signIn(page, base);
await page.goto(`${base}/transpa`, { waitUntil: "networkidle" });

ok("uppslaget finns överst", (await page.getByLabel("Person").count()) > 0);
ok("personen är förifylld", (await page.getByLabel("Person").inputValue()).length > 30);
ok("från-datum förifyllt", (await page.getByLabel("Från och med").inputValue()) === "2026-08-17");
ok("till-datum förifyllt", (await page.getByLabel("Till och med").inputValue()) === "2026-08-28");

await page.getByRole("button", { name: /Hämta passen/ }).click();
await page.waitForTimeout(6000);

const text = await page.locator("main").innerText();
const svar = text.split("\n").find((l) => /pass 2026-08-17|Hittade ingen|Inga TransPA|inte inom/.test(l));
console.log("   svar:", svar ?? "(inget svar syns)");
ok("åtgärden svarade", svar !== undefined);

console.log("JS-fel:", errors.length ? errors.slice(0, 2) : "inga");
await browser.close();
