import { describe, expect, it } from "vitest";
import { weeksOfSpan } from "./vacation-year";
import { mondayOfWeek, addDays } from "@/lib/week";

describe("weeksOfSpan", () => {
  it("täcker veckorna ett spann berör", () => {
    const from = mondayOfWeek(2026, 28);
    const to = addDays(mondayOfWeek(2026, 30), 6);
    expect(weeksOfSpan(2026, from, to)).toEqual([28, 29, 30]);
  });

  it("räknar en endagsfrånvaro till sin vecka", () => {
    const d = addDays(mondayOfWeek(2026, 12), 2);
    expect(weeksOfSpan(2026, d, d)).toEqual([12]);
  });

  it("tar med veckan även när spannet bara nuddar dess kant", () => {
    const sunday = addDays(mondayOfWeek(2026, 20), 6);
    expect(weeksOfSpan(2026, sunday, sunday)).toEqual([20]);
  });

  it("tar bara med veckor i det efterfrågade året", () => {
    // Spannet sträcker sig in i nästa år men frågan gäller 2026.
    const from = mondayOfWeek(2026, 52);
    const to = addDays(mondayOfWeek(2027, 2), 6);
    const weeks = weeksOfSpan(2026, from, to);
    expect(weeks.at(0)).toBe(52);
    expect(Math.max(...weeks)).toBeLessThanOrEqual(53);
  });
});
