/** Rollfiltret: i Grunddata och i personalväljaren. */
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

/* Grunddata */
await page.goto(`${base}/grunddata`, { waitUntil: "networkidle" });
const alla = await page.locator("tbody tr").count();
ok("rollfiltret finns i Grunddata", (await page.getByLabel("Filtrera på roll").count()) > 0);

await page.getByLabel("Filtrera på roll").selectOption("driver");
await page.waitForTimeout(400);
const chaufforer = await page.locator("tbody tr").count();
console.log(`   alla: ${alla} · chaufförer: ${chaufforer}`);
ok("filtret sorterar bort dem som inte kör", chaufforer > 0 && chaufforer < alla);
ok("rollen syns i tabellen", (await page.locator("tbody").innerText()).includes("chaufför"));

/* Personalväljaren */
await page.goto(`${base}/tavla/fjarr-nybro?ar=2026&vecka=35`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "+ lägg till" }).click();
await page.waitForTimeout(600);
ok("rollfiltret finns i väljaren", (await page.getByLabel("Filtrera på roll").count()) > 0);

const foreFilter = await page.locator("label:has(input[type=checkbox])").count();
await page.getByLabel("Filtrera på roll").selectOption("garage");
await page.waitForTimeout(400);
const efterFilter = await page.locator("label:has(input[type=checkbox])").count();
console.log(`   före: ${foreFilter} · bara garage: ${efterFilter}`);
ok("väljaren smalnar av på roll", efterFilter > 0 && efterFilter < foreFilter);

console.log("JS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
