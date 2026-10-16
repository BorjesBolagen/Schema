import { describe, expect, it } from "vitest";
import {
  appliesTo,
  cyclePosition,
  describeRule,
  kommandeVeckor,
  kopplingarFrånVeckor,
  linjerPerCykelvecka,
  MAX_CYCLE_WEEKS,
  specificity,
} from "./rotation";

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

  it("klarar ett tioveckorsschema", () => {
    expect(MAX_CYCLE_WEEKS).toBeGreaterThanOrEqual(10);
    // Vecka 1–10 är ett varv, vecka 11 börjar om.
    expect(Array.from({ length: 11 }, (_, i) => cyclePosition(i + 1, 10))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1,
    ]);
    expect(cyclePosition(1, 10, 9)).toBe(10);
  });
});

describe("kommandeVeckor", () => {
  it("hittar cykelvecka 9 och 10 i en tioveckorscykel", () => {
    expect(
      kommandeVeckor({ year: 2026, week: 1, cycleLength: 10, cycleOffset: 0, cycleWeeks: [9, 10], antal: 4 }),
    ).toEqual([9, 10, 19, 20]);
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

describe("veckoschema per person", () => {
  const fyraVeckor = [
    [
      { boardRowId: "BT13", weekdays: [1, 2, 3, 4] },
      { boardRowId: "BT24", weekdays: [5] },
    ],
    [{ boardRowId: "BT24", weekdays: [] }],
    [],
    [{ boardRowId: "BT50", weekdays: [3, 1] }],
  ];

  it("blir en koppling per vecka och linje", () => {
    expect(kopplingarFrånVeckor(fyraVeckor, 4, 2)).toEqual([
      { boardRowId: "BT13", weekdays: [1, 2, 3, 4], cycleWeeks: [1], cycleLength: 4, cycleOffset: 2, sortOrder: 0 },
      { boardRowId: "BT24", weekdays: [5], cycleWeeks: [1], cycleLength: 4, cycleOffset: 2, sortOrder: 1 },
      { boardRowId: "BT24", weekdays: null, cycleWeeks: [2], cycleLength: 4, cycleOffset: 2, sortOrder: 2 },
      { boardRowId: "BT50", weekdays: [1, 3], cycleWeeks: [4], cycleLength: 4, cycleOffset: 2, sortOrder: 3 },
    ]);
  });

  it("läses tillbaka till samma veckor", () => {
    const kopplingar = kopplingarFrånVeckor(fyraVeckor, 4, 2);
    expect(linjerPerCykelvecka(kopplingar, 4, 2)).toEqual([
      fyraVeckor[0],
      fyraVeckor[1],
      [],
      [{ boardRowId: "BT50", weekdays: [1, 3] }],
    ]);
  });

  it("ger stående kopplingar i en cykel på en vecka", () => {
    expect(kopplingarFrånVeckor([[{ boardRowId: "BT13", weekdays: [] }]], 1, 3)).toEqual([
      { boardRowId: "BT13", weekdays: null, cycleWeeks: null, cycleLength: 1, cycleOffset: 0, sortOrder: 0 },
    ]);
  });

  it("lägger en stående koppling i varje vecka", () => {
    const stående = { boardRowId: "BT13", weekdays: null, cycleWeeks: null, cycleLength: 1, cycleOffset: 0, sortOrder: 0 };
    expect(linjerPerCykelvecka([stående], 3, 0)).toEqual([
      [{ boardRowId: "BT13", weekdays: [] }],
      [{ boardRowId: "BT13", weekdays: [] }],
      [{ boardRowId: "BT13", weekdays: [] }],
    ]);
  });

  it("lägger ut en tvåveckorsregel i en fyraveckorscykel", () => {
    const varannan = { boardRowId: "BT13", weekdays: null, cycleWeeks: [1], cycleLength: 2, cycleOffset: 0, sortOrder: 0 };
    expect(linjerPerCykelvecka([varannan], 4, 0).map((v) => v.length)).toEqual([1, 0, 1, 0]);
  });

  it("klarar tio veckor och släpper veckor utanför cykeln", () => {
    const tolv = Array.from({ length: 12 }, (_, i) => [{ boardRowId: `R${i + 1}`, weekdays: [] }]);
    const ut = kopplingarFrånVeckor(tolv, 10, 0);
    expect(ut).toHaveLength(10);
    expect(ut.at(-1)).toMatchObject({ boardRowId: "R10", cycleWeeks: [10], cycleLength: 10 });
  });
});
