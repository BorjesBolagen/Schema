import { describe, expect, it } from "vitest";
import { getDb, withDbTimeout } from "./index";

describe("withDbTimeout", () => {
  it("rör inte den delade kopplingen på timeout", async () => {
    // Fluid kan låta flera samtidiga förfrågningar dela samma koppling.
    // En förfrågan som ger upp får inte krascha en annan som råkar
    // använda samma koppling just då — se resetDb() i index.ts för hela
    // historien. Det testas här genom att kontrollera att getDb() ger
    // exakt samma objekt före och efter en timeout, inte ett nytt.
    const before = getDb();
    const neverResolves = () => new Promise<never>(() => {});
    await expect(withDbTimeout(neverResolves, 15)).rejects.toThrow(/svarade inte inom/);
    expect(getDb()).toBe(before);
  });


  it("släpper igenom resultatet när anropet hinner klart", async () => {
    const result = await withDbTimeout(() => Promise.resolve("klar"), 50);
    expect(result).toBe("klar");
  });

  it("kastar ett läsligt fel i stället för att vänta för evigt", async () => {
    const neverResolves = () => new Promise<never>(() => {});
    await expect(withDbTimeout(neverResolves, 20)).rejects.toThrow(/svarade inte inom/);
  });

  it("låter ett riktigt fel från anropet gå igenom oförändrat", async () => {
    await expect(
      withDbTimeout(() => Promise.reject(new Error("något annat gick fel")), 50),
    ).rejects.toThrow("något annat gick fel");
  });
});
