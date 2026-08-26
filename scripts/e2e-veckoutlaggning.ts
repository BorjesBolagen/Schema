/**
 * Johans flöde, i en riktig webbläsare:
 * sök fram en person ur hela registret, dra ut hen på en rad, och få
 * hela veckan utlagd enligt hens arbetsmönster.
 */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3211";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const ok = (label: string, pass: boolean) => console.log(`${pass ? "✓" : "✗"} ${label}`);

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro?ar=2026&vecka=35`, { waitUntil: "networkidle" });

const search = page.getByLabel("Sök i all personal");
ok("sökfältet finns i sidopanelen", (await search.count()) > 0);

// En person som inte är med i bemanningen.
await search.fill("Fredrik");
await page.waitForTimeout(400);
const hit = page.locator("aside li", { hasText: "Fredrik" }).first();
const hits = await page.locator("aside li").count();
ok("sökningen ger träff utanför bemanningen", (await hit.count()) > 0);
console.log("   träffar:", hits);

const rowHeader = page.locator("th", { hasText: "HF03" }).first();
ok("radhuvudet finns", (await rowHeader.count()) > 0);

const before = await page.locator("tr", { has: page.locator("th", { hasText: "HF03" }) }).innerText();

// Dra träffen till radhuvudet.
const from = await hit.boundingBox();
const to = await rowHeader.boundingBox();
if (!from || !to) throw new Error("hittade inte elementen att dra mellan");
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(from.x + 40, from.y + 20, { steps: 8 });
const label = await page.locator("th", { hasText: "hela veckan" }).count();
ok("radhuvudet tänds under dragningen", label > 0);
await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(3500);

const after = await page.locator("tr", { has: page.locator("th", { hasText: "HF03" }) }).innerText();
ok("raden bemannades", after.includes("Fredrik") && !before.includes("Fredrik"));
console.log("   HF03 efter:", after.replace(/\s+/g, " ").slice(0, 160));

const note = (await page.locator("body").innerText())
  .split("\n")
  .find((l) => /pass utlagda|saknar arbetsmönster/.test(l));
console.log("   återkoppling:", note ?? "(ingen)");

const placed = (after.match(/Fredrik/g) ?? []).length;
ok("hela veckan lades ut, inte bara en dag", placed > 1);

console.log("JS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
