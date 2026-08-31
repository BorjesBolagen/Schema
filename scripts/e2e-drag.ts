/** Fyller veckan och drar sedan pass med musen. */
import { chromium, type Page } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3211";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Flera steg så dnd-kit hinner registrera rörelsen.
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await page.waitForTimeout(30);
  }
  const dragging = await page.locator('[role="status"], .cursor-grabbing').count();
  const overlay = await page.locator("body").innerText().then((t) => t.includes("Max Kellgren"));
  console.log(`   (mitt i dragningen: overlay-element=${dragging}, text-syns=${overlay})`);
  await page.mouse.up();
  await page.waitForTimeout(1800);
}

const centre = async (p: Page, selector: string, nth = 0) => {
  const box = await p.locator(selector).nth(nth).boundingBox();
  if (!box) throw new Error(`hittade inte ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${weekQuery()}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(2500);

const rowText = async (label: string) =>
  (await page.locator(`tbody tr:has(th:text-is("${label}"))`).innerText()).replace(/\n+/g, " ");

console.log("HF03 före:", await rowText("HF03"));
console.log("Ej utlagda före:", await page.locator("aside").innerText().then((t) => t.split("\n")[2]));

// Dra Max Kellgren ur sidopanelen till HF03 måndag.
const maxCard = await centre(page, 'aside li:has-text("Max Kellgren")');
const hf03Mon = await centre(page, 'tbody tr:has(th:text-is("HF03")) [data-shift="day"]', 0);
await drag(maxCard, hf03Mon);

console.log("HF03 efter drag från panelen:", await rowText("HF03"));
console.log("Ej utlagda efter:", await page.locator("aside").innerText().then((t) => t.split("\n")[2]));

// Flytta passet från måndag till tisdag på samma rad.
const pass = await centre(page, 'tbody tr:has(th:text-is("HF03")) span:has-text("Max Kellgren")');
const hf03Tue = await centre(page, 'tbody tr:has(th:text-is("HF03")) [data-shift="day"]', 1);
await drag(pass, hf03Tue);
console.log("HF03 efter flytt till tisdag:", await rowText("HF03"));

await page.screenshot({ path: "/tmp/dragged.png" });
console.log("JS-fel:", errors.length ? errors.slice(0, 3) : "inga");
await browser.close();
