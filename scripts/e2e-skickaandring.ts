/**
 * "Skicka schemaändring" — bekräftelsen och spärren.
 *
 * Skrivningen går mot Börjes produktionstenant, så det som provas här
 * är att inget skickas av misstag: att knappen räknar upp exakt vad som
 * lämnar huset, att avbryt inte skickar något, och att en riktig
 * chaufför är utgråad med skälet utskrivet.
 *
 * Själva anropet mot TransPA nås inte härifrån (nätet är stängt) — det
 * täcks av enhetstesterna i shift-write.test.ts.
 */
import { chromium } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3400";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);
const panel = () => page.locator("div.border-\\(--color-warn\\)").first();

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${weekQuery()}`, { waitUntil: "networkidle" });

/* ---- Utan ändringar: knappen ska säga att det inte finns något ---- */
await page.getByRole("button", { name: /Skicka till TransPA/ }).click();
await page.waitForTimeout(2500);
const utan = await panel().innerText();
console.log("  utan ändringar:", utan.replace(/\s+/g, " ").slice(0, 120));
check("säger ifrån när inget ändrats", utan.includes("Inga flyttade pass"));
check("skicka-knappen är avstängd", await panel().getByRole("button", { name: /Inget att skicka/ }).isDisabled());
await panel().getByRole("button", { name: "Avbryt" }).click();
await page.waitForTimeout(600);

/* ---- Flytta ett pass med musen ---- */
const dagrad = (bil: string) => page.locator(`tbody tr[data-row="${bil}"][data-shift="day"]`);
const mitten = async (loc: ReturnType<typeof page.locator>) => {
  const box = await loc.boundingBox();
  if (!box) throw new Error("hittade inte elementet att dra");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/* Alma kör HF03 torsdag och fredag och är ledig måndag. Målet måste
   vara en dag hon inte redan jobbar — flyttar man ett pass till en dag
   personen redan står på är det ingen flytt, bara ett pass som
   försvunnit, och då finns inget att skicka. */
const kortet = dagrad("HF03").locator("span.cursor-grab").first();
const fran = await mitten(kortet);
const till = await mitten(dagrad("HF03").locator("td").nth(2)); // måndagen

const fore = await dagrad("HF03").innerText();
await page.mouse.move(fran.x, fran.y);
await page.mouse.down();
// Flera steg, annars hinner dnd-kit inte se att det är en dragning.
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(fran.x + ((till.x - fran.x) * i) / 12, fran.y + ((till.y - fran.y) * i) / 12);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(3000);
const efter = await dagrad("HF03").innerText();
check("passet flyttades på tavlan", fore !== efter);
console.log("  HF03 efter:", efter.replace(/\s+/g, " ").slice(0, 130));

/* ---- Nu ska ändringen räknas upp ---- */
await page.getByRole("button", { name: /Skicka till TransPA/ }).click();
await page.waitForTimeout(2500);
const med = await panel().innerText();
console.log("  med ändring:", med.replace(/\s+/g, " ").slice(0, 220));
check("ändringen räknas upp med namn", /Alma Persson/.test(med));
check("från- och till-dag står utskrivna", /→/.test(med));
check(
  "en riktig chaufför är gråtonad med skäl",
  med.includes("bara testpersonen får skrivas till"),
);
check(
  "skicka-knappen är avstängd när ingen får skrivas till",
  await panel().getByRole("button", { name: /Inget att skicka/ }).isDisabled(),
);

/* ---- Avbryt ska inte skicka något ---- */
await panel().getByRole("button", { name: "Avbryt" }).click();
await page.waitForTimeout(800);
check(
  "avbryt stänger utan att skicka",
  (await page.locator("body").innerText()).includes("Skicka till TransPA"),
);

await page.screenshot({ path: "/tmp/skicka.png" });
await browser.close();
console.log("\nJS-fel:", errors.length ? errors.slice(0, 3) : "inga");
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
