/**
 * Tar en bild av en sida i den körande appen.
 *
 * Används för att granska vyerna, och är samma mekanism som
 * PDF-exporten kommer att vila på: sidan renderas av Chromium, så
 * utskriften ser ut som skärmen.
 *
 *   npx tsx scripts/screenshot.ts <url> <utfil.png>
 */
import { chromium } from "playwright-core";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("Användning: npx tsx scripts/screenshot.ts <url> <utfil.png>");
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log("skrev", out);
