import { describe, expect, it } from "vitest";
import { appliesTo, cyclePosition, describeRule, specificity } from "./rotation";

/**
 * Sanningen om cykeln ligger i Värnamobladets Lists-flik, som mappar
 * veckonummer till passnummer. Testet nedan är den tabellen, inte en
 * omskrivning av formeln — går formeln sönder ska det synas mot verklig
 * data och inte mot sig själv.
 */
describe("cyclePosition", () => {
  /* Ur bladet: vecka 1 → pass 3, och sedan rullande. */
  const VARNAMO: Array<[number, number]> = [
    [1, 3], [2, 4], [3, 1], [4, 2],
    [5, 3], [6, 4], [7, 1], [8, 2],
    [9, 3], [10, 4], [11, 1], [12, 2],
    [31, 1], [52, 2],
  ];

  it("reproducerar Värnamobladets vecka→pass", () => {
    for (const [vecka, pass] of VARNAMO) {
      expect([vecka, cyclePosition(vecka, 4, 2)]).toEqual([vecka, pass]);
    }
  });

  it("ger alltid 1 när det inte finns någon rotation", () => {
    for (const v of [1, 2, 17, 52]) expect(cyclePosition(v, 1)).toBe(1);
  });

  it("håller sig inom cykeln", () => {
    for (let v = 1; v <= 53; v++) {
      const p = cyclePosition(v, 3, 1);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(3);
    }
  });

  it("går runt utan hopp vid årsskiftet", () => {
    // Vecka 52 och 53 följer på varandra som vilka veckor som helst.
    const rad = [51, 52, 53].map((v) => cyclePosition(v, 4, 2));
    expect(rad).toEqual([cyclePosition(51, 4, 2), cyclePosition(51, 4, 2) % 4 + 1, (cyclePosition(51, 4, 2) + 1) % 4 + 1]);
  });

  it("tål en förskjutning större än cykeln", () => {
    expect(cyclePosition(1, 4, 6)).toBe(cyclePosition(1, 4, 2));
  });
});

describe("appliesTo", () => {
  const alltid = { cycleWeeks: null, weekdays: null };
  const tisdagar = { cycleWeeks: null, weekdays: [2] };
  const veckaTre = { cycleWeeks: [3], weekdays: null };
  const tisdagVeckaTre = { cycleWeeks: [3], weekdays: [2] };

  /* Tomt betyder alla, inte inga: en koppling utan angivna veckodagar
     är en stående koppling och ska bete sig som förut. */
  it("gäller alltid när ingenting är angivet", () => {
    expect(appliesTo(alltid, { position: 1, weekday: 1 })).toBe(true);
    expect(appliesTo({ cycleWeeks: [], weekdays: [] }, { position: 2, weekday: 5 })).toBe(true);
  });

  it("begränsar på veckodag", () => {
    expect(appliesTo(tisdagar, { position: 1, weekday: 2 })).toBe(true);
    expect(appliesTo(tisdagar, { position: 1, weekday: 3 })).toBe(false);
  });

  it("begränsar på cykelvecka", () => {
    expect(appliesTo(veckaTre, { position: 3, weekday: 1 })).toBe(true);
    expect(appliesTo(veckaTre, { position: 2, weekday: 1 })).toBe(false);
  });

  it("kräver båda när båda är angivna", () => {
    expect(appliesTo(tisdagVeckaTre, { position: 3, weekday: 2 })).toBe(true);
    expect(appliesTo(tisdagVeckaTre, { position: 3, weekday: 3 })).toBe(false);
    expect(appliesTo(tisdagVeckaTre, { position: 2, weekday: 2 })).toBe(false);
  });
});

describe("specificity", () => {
  it("rangordnar undantag före huvudregel", () => {
    expect(specificity({ cycleWeeks: [3], weekdays: [2] })).toBe(2);
    expect(specificity({ cycleWeeks: [3], weekdays: null })).toBe(1);
    expect(specificity({ cycleWeeks: null, weekdays: [2] })).toBe(1);
    expect(specificity({ cycleWeeks: null, weekdays: null })).toBe(0);
  });
});

describe("describeRule", () => {
  it("beskriver en stående koppling", () => {
    expect(describeRule({ cycleWeeks: null, weekdays: null }, 1)).toBe("alltid");
  });

  it("räknar upp veckodagar med måndag först", () => {
    expect(describeRule({ cycleWeeks: null, weekdays: [0, 2, 1] }, 1)).toBe("mån, tis, sön");
  });

  it("nämner cykelveckan bara när tavlan har en cykel", () => {
    expect(describeRule({ cycleWeeks: [3], weekdays: null }, 4)).toBe("v. 3 av 4");
    expect(describeRule({ cycleWeeks: [3], weekdays: null }, 1)).toBe("alltid");
  });

  it("skriver ihop veckodag och cykelvecka", () => {
    expect(describeRule({ cycleWeeks: [1, 3], weekdays: [2] }, 4)).toBe("tis · v. 1/3 av 4");
  });
});
