import { describe, expect, it } from "vitest";
import { shiftWindow } from "./shifts";

/**
 * Uppslaget frågar 17–28 augusti. Fönstret måste täcka hela slutdagen —
 * ett pass som börjar 22:00 den 28:e faller annars utanför, och listan
 * ser kortare ut än den är utan att något sagt ifrån.
 */
describe("fönstret för ett uppslag", () => {
  const q = shiftWindow("2026-08-17", "2026-08-28");

  it("börjar vid början av första dagen", () => {
    expect(q.startDateTimeAfter).toBe("2026-08-17T00:00:00.000Z");
  });

  it("sträcker sig till slutet av sista dagen, inte till dess början", () => {
    expect(q.startDateTimeBefore).toBe("2026-08-28T23:59:59.000Z");
  });

  it("täcker ett pass som börjar sent på slutdagen", () => {
    const sent = new Date("2026-08-28T21:00:00Z").getTime();
    expect(sent).toBeGreaterThan(new Date(q.startDateTimeAfter).getTime());
    expect(sent).toBeLessThan(new Date(q.startDateTimeBefore).getTime());
  });
});
