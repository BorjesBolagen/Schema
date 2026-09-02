import { describe, expect, it } from "vitest";
import {
  AdjustedWorkTimeError,
  CALCULATE_PATH,
  readAdjustedWorkTime,
} from "./adjusted-work-time";

/**
 * Checksumman är det som fattades.
 *
 * PUT /v1/shifts/{id} har checkSum som obligatorisk frågeparameter, och
 * utan den svarar TransPA 404 "Resource not found" — på ett pass som
 * hämtats utan problem sekunden innan. Samma mönster som listvägen, som
 * svarade 404 tills datumparametrarna kom med.
 */

describe("readAdjustedWorkTime", () => {
  it("plockar checksumman och minuterna ur svaret", () => {
    const ut = readAdjustedWorkTime({
      checkSum: "b1df383d-23f5-4aa3-118c-bbb551abfd9d",
      adjustedWorkTimeInMinutes: 540,
    });
    expect(ut.checkSum).toBe("b1df383d-23f5-4aa3-118c-bbb551abfd9d");
    expect(ut.adjustedWorkTimeInMinutes).toBe(540);
  });

  /* Vismas genererade klient är PascalCase, deras egna exempel
     camelCase. Vilket svaret bär syns först i ett riktigt svar. */
  it("bryr sig inte om skiftläge", () => {
    expect(readAdjustedWorkTime({ CheckSum: "abc" }).checkSum).toBe("abc");
  });

  it("går ett steg ned i ett kuvert", () => {
    const ut = readAdjustedWorkTime({
      result: { checkSum: "abc", adjustedWorkTimeInMinutes: 480 },
    });
    expect(ut.checkSum).toBe("abc");
    expect(ut.adjustedWorkTimeInMinutes).toBe(480);
  });

  /* Utan minuter går skrivningen ändå vidare — då står vårt eget värde
     kvar, vilket är sämre men inte fel. Utan checksumma finns ingen
     skrivning att göra. */
  it("klarar sig utan minuterna", () => {
    expect(readAdjustedWorkTime({ checkSum: "abc" }).adjustedWorkTimeInMinutes).toBeUndefined();
  });

  it("kastar när checksumman saknas", () => {
    expect(() => readAdjustedWorkTime({ minutes: 540 })).toThrow(AdjustedWorkTimeError);
  });

  /* Felet ska säga vad som *fanns*. Det är den upplysningen som gör
     nästa försök billigt när kvoten är liten. */
  it("räknar upp nycklarna som fanns i svaret", () => {
    try {
      readAdjustedWorkTime({ data: { workTime: 540 }, status: "ok" });
      throw new Error("skulle ha kastat");
    } catch (e) {
      expect((e as Error).message).toContain("data.workTime");
      expect((e as Error).message).toContain("status");
      expect((e as Error).message).toContain(CALCULATE_PATH);
    }
  });

  it("säger 'inga' när svaret var tomt", () => {
    expect(() => readAdjustedWorkTime(null)).toThrow(/inga/);
  });

  it("godtar inte en tom sträng som checksumma", () => {
    expect(() => readAdjustedWorkTime({ checkSum: "" })).toThrow(AdjustedWorkTimeError);
  });
});
