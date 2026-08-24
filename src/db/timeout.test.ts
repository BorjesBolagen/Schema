import { describe, expect, it, vi } from "vitest";
import { getDb, readWithTimeout } from "./index";

describe("readWithTimeout", () => {
  it("släpper igenom resultatet när anropet hinner klart", async () => {
    const result = await readWithTimeout(() => Promise.resolve("klar"), 50);
    expect(result).toBe("klar");
  });

  it("gör ett omtag på en färsk koppling när sockeln dött tyst", async () => {
    // Det verkliga felet: postgres-drivrutinen har ingen lässtidsgräns,
    // så en död sockel ger varken svar eller fel — bara tystnad. Första
    // försöket ska ge upp, kopplingen bytas ut, och andra försöket
    // lyckas. Här härmas det med ett anrop som hänger en gång.
    const before = getDb();
    let calls = 0;
    const hangsOnce = () => {
      calls++;
      return calls === 1 ? new Promise<string>(() => {}) : Promise.resolve("andra försöket");
    };

    await expect(readWithTimeout(hangsOnce, 20)).resolves.toBe("andra försöket");
    expect(calls).toBe(2);
    // Kopplingen ska ha pensionerats, inte återanvänts.
    expect(getDb()).not.toBe(before);
  });

  it("ger upp med ett läsligt fel när även omtaget hänger", async () => {
    const neverResolves = () => new Promise<never>(() => {});
    await expect(readWithTimeout(neverResolves, 20)).rejects.toThrow(/svarade inte inom/);
  });

  it("låter ett riktigt fel gå igenom direkt, utan omtag", async () => {
    // Bara tystnad ska ge omtag. Ett verkligt fel — fel lösenord, en
    // saknad tabell — betyder att omtaget ändå skulle misslyckas, och
    // ska synas på en gång i stället för att fördröjas.
    const fn = vi.fn(() => Promise.reject(new Error("något annat gick fel")));
    await expect(readWithTimeout(fn, 50)).rejects.toThrow("något annat gick fel");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
