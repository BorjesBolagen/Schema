import { describe, expect, it } from "vitest";
import { dateRangeLabel, isoWeek, mondayOfWeek, weekDates, weeksInYear } from "./week";

describe("isoWeek", () => {
  it("räknar vecka enligt ISO", () => {
    expect(isoWeek("2025-06-30")).toEqual({ year: 2025, week: 27 });
    expect(isoWeek("2026-08-03")).toEqual({ year: 2026, week: 32 });
  });

  it("hanterar årsskiften", () => {
    // 2024-12-30 är måndag i vecka 1 år 2025.
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
    // 2021-01-01 tillhör vecka 53 år 2020.
    expect(isoWeek("2021-01-01")).toEqual({ year: 2020, week: 53 });
  });
});

describe("mondayOfWeek", () => {
  it("är invers till isoWeek", () => {
    for (const iso of ["2025-06-30", "2026-08-03", "2024-12-30", "2020-12-28"]) {
      const { year, week } = isoWeek(iso);
      expect(isoWeek(mondayOfWeek(year, week))).toEqual({ year, week });
    }
  });
});

describe("weeksInYear", () => {
  it("känner till långa år", () => {
    expect(weeksInYear(2020)).toBe(53);
    expect(weeksInYear(2026)).toBe(53);
    expect(weeksInYear(2025)).toBe(52);
  });
});

describe("weekDates", () => {
  it("ger måndag–fredag för dagschemat", () => {
    expect(weekDates(2025, 27, 1, [1, 2, 3, 4, 5])).toEqual([
      "2025-06-30",
      "2025-07-01",
      "2025-07-02",
      "2025-07-03",
      "2025-07-04",
    ]);
  });

  it("inleder veckan med söndagen före ISO-måndagen, som fjärrbladet gör", () => {
    expect(weekDates(2025, 27, 0, [0, 1, 2, 3, 4, 5])).toEqual([
      "2025-06-29",
      "2025-06-30",
      "2025-07-01",
      "2025-07-02",
      "2025-07-03",
      "2025-07-04",
    ]);
  });

  it("visar hela veckan när alla dagar är påslagna", () => {
    expect(weekDates(2025, 27, 1, [0, 1, 2, 3, 4, 5, 6])).toHaveLength(7);
  });
});

describe("dateRangeLabel", () => {
  it("skriver ut månaden en gång när veckan ryms i den", () => {
    expect(dateRangeLabel(["2026-08-03", "2026-08-07"])).toBe("3–7 aug 2026");
  });

  it("skriver ut båda månaderna vid månadsskifte", () => {
    expect(dateRangeLabel(["2025-06-29", "2025-07-04"])).toBe("29 juni–4 juli 2025");
  });
});
