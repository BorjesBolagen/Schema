/**
 * Arbetsgången som gör 281 chaufförer till några klick:
 * filtrera till dem utan mönster, markera alla som syns, sätt mån–fre.
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
await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });

ok("mönsterkolumnen finns", (await page.getByRole("columnheader", { name: "Arbetsmönster" }).count()) > 0);
const body = await page.locator("tbody").innerText();
ok("mönstret sammanfattas i klartext", /mån–fre|4 v\. cykel/.test(body));
ok("den som saknar mönster märks ut", body.includes("saknas"));

await page.getByText("Bara utan arbetsmönster").click();
await page.waitForTimeout(400);
const utan = await page.locator("tbody tr").count();
console.log("   utan mönster:", utan);
ok("filtret hittar dem utan mönster", utan > 0);

await page.getByLabel("Markera alla som visas").check();
await page.waitForTimeout(300);
ok("massättningsraden visar antalet", await page.getByText(`${utan} valda`).isVisible());
ok("veckodagarna är förvalda mån–fre", await page.getByRole("button", { name: `Sätt mönster på ${utan}` }).isEnabled());

await page.getByRole("button", { name: `Sätt mönster på ${utan}` }).click();
await page.waitForTimeout(3000);
await page.reload({ waitUntil: "networkidle" });

await page.getByText("Bara utan arbetsmönster").click();
await page.waitForTimeout(400);
const kvar = await page.locator("tbody tr").count();
console.log("   kvar utan mönster:", kvar);
ok("alla fick mönster", kvar === 0);

ok(
  "tom lista sägs bero på filtret, inte på tomt register",
  (await page.locator("main").innerText()).includes("Ingen matchar filtren"),
);

// Stäng av filtret och kontrollera vad som faktiskt skrevs.
await page.getByText("Bara utan arbetsmönster").click();
await page.waitForTimeout(400);
const efter = await page.locator("tbody").innerText();
ok("mönstret blev mån–fre dag", efter.includes("mån–fre ☀️"));

console.log("JS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
