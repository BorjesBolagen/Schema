/** Ta bort en hel tavla från listan där tavlorna syns. */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3211";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const ok = (l: string, p: boolean) => console.log(`${p ? "✓" : "✗"} ${l}`);

await signIn(page, base);
await page.goto(base, { waitUntil: "networkidle" });

const före = await page.locator("main ul li").count();
ok("knappen finns i listan", (await page.getByRole("button", { name: /^Ta bort Fjärr/ }).count()) > 0);

await page.getByRole("button", { name: /^Ta bort Fjärr/ }).click();
await page.waitForTimeout(2500);

const text = await page.locator("main").innerText();
ok("bekräftelsen räknar raderna", /\d+ rader/.test(text));
ok("bekräftelsen nämner pass", /\d+ pass/.test(text));
ok("säger att det inte går att ångra", text.includes("Går inte att ångra"));
ok("säger att personalen finns kvar", text.includes("Personalen finns kvar"));

await page.getByRole("button", { name: "Avbryt" }).click();
await page.waitForTimeout(500);
ok("avbryt lämnar tavlan i fred", (await page.locator("main ul li").count()) === före);

await page.getByRole("button", { name: /^Ta bort Fjärr/ }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: "Ta bort tavlan" }).click();
await page.waitForTimeout(3000);

const efter = await page.locator("main").innerText();
ok("tavlan är borta från listan", !efter.includes("Fjärr Nybro"));

await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });
ok("personalen finns kvar", (await page.locator("tbody tr").count()) > 0);

console.log("JS-fel:", errors.length ? errors.slice(0, 2) : "inga");
await browser.close();
