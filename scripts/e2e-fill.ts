/** Kör igenom flödet i en riktig webbläsare: fyll veckan och flytta ett pass. */
import { chromium } from "playwright-core";
import { signIn, weekQuery } from "./e2e-helpers";

const base = process.env.BASE_URL ?? "http://localhost:3210";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await signIn(page, base);
await page.goto(`${base}/tavla/fjarr-nybro${weekQuery()}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Fyll veckan/ }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/filled.png" });

console.log("--- efter omladdning ---");
await page.reload({ waitUntil: "networkidle" });
await page.screenshot({ path: "/tmp/filled-reload.png" });

const summary = await page.locator("main").innerText();
console.log("--- efter Fyll veckan ---");
console.log(
  summary
    .split("\n")
    .filter((l) => /utlagda|saknar bil|pass utlagda|dubbelbok|frånvaro/i.test(l))
    .join("\n") || "(ingen varningsrad)",
);
console.log("\nRader i rutnätet:");
for (const row of await page.locator("tbody tr").all()) {
  const t = (await row.innerText()).replace(/\n+/g, " | ");
  if (t.trim()) console.log("  " + t);
}
console.log("\nSidopanel:");
console.log(
  (await page.locator("aside").innerText()).split("\n").filter(Boolean).slice(0, 20).join(" / "),
);
console.log("\nJS-fel:", errors.length ? errors.slice(0, 5) : "inga");
await browser.close();
