/** Massättning av stationsort i Grunddata — sök, markera flera, sätt ort. */
import { chromium } from "playwright-core";
import { signIn } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3211";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const ok = (label: string, pass: boolean) => console.log(`${pass ? "✓" : "✗"} ${label}`);

await signIn(page, base);
await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });

const search = page.getByLabel("Sök personal");
ok("sökfältet finns", (await search.count()) > 0);
ok("filtret 'bara utan stationsort' finns", await page.getByText("Bara utan stationsort").isVisible());

await search.fill("Håkansson");
await page.waitForTimeout(400);
const shown = await page.locator("tbody tr").count();
console.log("   rader efter sökning:", shown);
ok("sökningen smalnar av listan", shown > 0 && shown < 12);

await page.getByRole("checkbox", { name: /^Markera Anders/ }).check();
await page.waitForTimeout(300);
ok("massättningsraden dyker upp", await page.getByText("1 valda").isVisible());

// Rullgardinen i massättningsraden, inte radens egen.
const bulk = page.getByLabel("Sätt stationsort");
ok("massättningens rullgardin finns", (await bulk.count()) > 0);
await bulk.selectOption({ label: "Växjö" });
await page.getByRole("button", { name: /^Sätt på 1$/ }).click();
await page.waitForTimeout(2500);

await page.reload({ waitUntil: "networkidle" });
await page.getByLabel("Sök personal").fill("Håkansson");
await page.waitForTimeout(400);
const row = await page.locator("tbody tr").first().innerText();
console.log("   raden efter:", row.replace(/\s+/g, " ").slice(0, 80));
const chosen = await page.locator("tbody tr").first().locator("select").inputValue();
const växjö = await page.locator("tbody tr").first().locator("select option", { hasText: "Växjö" }).getAttribute("value");
ok("orten sparades", chosen === växjö);

console.log("JS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
