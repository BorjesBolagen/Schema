import { describe, expect, it } from "vitest";
import {
  CompositeWorkDayProvider,
  cycleWeekFor,
  datesBetween,
  expandPatterns,
  type PatternDayLike,
  type PatternLike,
  type WorkDayProvider,
  type WorkDayResult,
} from "./work-days";
import { mondayOfWeek } from "./week";

const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;

describe("cycleWeekFor", () => {
  /**
   * Värnamo-filens Lists-flik mappar veckonummer till pass 1–4:
   * vecka 3 → pass 1, vecka 9 → pass 3, vecka 31 → pass 1.
   * Med ankaret på vecka 3 ska cykelveckan följa samma rytm.
   */
  const anchor = mondayOfWeek(2025, 3);

  it("följer Värnamos rullande fyraveckorscykel", () => {
    const passFor = (week: number) => cycleWeekFor(anchor, 4, mondayOfWeek(2025, week)) + 1;
    expect(passFor(3)).toBe(1);
    expect(passFor(4)).toBe(2);
    expect(passFor(5)).toBe(3);
    expect(passFor(6)).toBe(4);
    expect(passFor(7)).toBe(1);
    expect(passFor(9)).toBe(3);
    expect(passFor(31)).toBe(1);
  });

  it("räknar bakåt utan att hamna på negativa veckor", () => {
    expect(cycleWeekFor(anchor, 4, mondayOfWeek(2025, 1))).toBe(2);
    expect(cycleWeekFor(anchor, 4, mondayOfWeek(2024, 51))).toBe(0);
  });

  it("ger alltid cykelvecka 0 för ett vanligt veckoschema", () => {
    expect(cycleWeekFor(anchor, 1, "2025-11-04")).toBe(0);
  });

  it("låter söndagen ligga i sin egen ISO-vecka som förval", () => {
    // 2025-06-29 är söndag och tillhör ISO-vecka 26, inte 27.
    expect(cycleWeekFor(anchor, 4, "2025-06-29")).toBe(cycleWeekFor(anchor, 4, "2025-06-23"));
  });

  it("drar söndagen till veckan efter när mönstret börjar veckan på söndag", () => {
    // Värnamos rullschema har söndag först i passet, ihop med måndagen.
    expect(cycleWeekFor(anchor, 4, "2025-06-29", 0)).toBe(cycleWeekFor(anchor, 4, "2025-07-04", 0));
  });
});

describe("datesBetween", () => {
  it("tar med båda ändarna", () => {
    expect(datesBetween("2026-08-17", "2026-08-19")).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
  });
});

describe("expandPatterns", () => {
  const weekly: PatternLike = {
    id: "p1",
    employeeId: "e1",
    cycleWeeks: 1,
    anchorDate: "2026-01-05",
    weekStartsOn: 1,
    validFrom: null,
    validTo: null,
  };
  const weeklyDays: PatternDayLike[] = [MON, TUE, THU, FRI].map((weekday) => ({
    workPatternId: "p1",
    cycleWeek: 0,
    weekday,
    shift: "day" as const,
  }));

  it("ger vanliga veckodagar för en cykel på en vecka", () => {
    const out = expandPatterns([weekly], weeklyDays, "2026-08-17", "2026-08-21");
    expect(out.map((w) => w.date)).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-20",
      "2026-08-21",
    ]);
    expect(out.every((w) => w.shift === "day")).toBe(true);
  });

  it("roterar en fyraveckorscykel", () => {
    const rolling: PatternLike = { ...weekly, id: "p2", cycleWeeks: 4, anchorDate: mondayOfWeek(2026, 1) };
    const days: PatternDayLike[] = [
      { workPatternId: "p2", cycleWeek: 0, weekday: MON, shift: "day" },
      { workPatternId: "p2", cycleWeek: 1, weekday: WED, shift: "night" },
    ];
    const w1 = expandPatterns([rolling], days, mondayOfWeek(2026, 1), mondayOfWeek(2026, 1));
    expect(w1).toHaveLength(1);
    expect(w1[0].shift).toBe("day");

    const w2start = mondayOfWeek(2026, 2);
    const w2 = expandPatterns([rolling], days, w2start, "2026-01-11");
    expect(w2.map((w) => w.shift)).toEqual(["night"]);
  });

  it("låter ett senare mönster ta över utan att det gamla raderas", () => {
    const gammalt: PatternLike = { ...weekly, id: "old", validFrom: "2026-01-01", validTo: "2026-08-18" };
    const nytt: PatternLike = { ...weekly, id: "new", validFrom: "2026-08-19", validTo: null };
    const days: PatternDayLike[] = [
      { workPatternId: "old", cycleWeek: 0, weekday: MON, shift: "day" },
      { workPatternId: "old", cycleWeek: 0, weekday: TUE, shift: "day" },
      { workPatternId: "new", cycleWeek: 0, weekday: WED, shift: "night" },
      { workPatternId: "new", cycleWeek: 0, weekday: THU, shift: "night" },
    ];
    const out = expandPatterns([gammalt, nytt], days, "2026-08-17", "2026-08-21");
    expect(out.map((w) => [w.date, w.shift])).toEqual([
      ["2026-08-17", "day"],
      ["2026-08-18", "day"],
      ["2026-08-19", "night"],
      ["2026-08-20", "night"],
    ]);
  });

  it("ger inga dagar utanför mönstrets giltighet", () => {
    const kort: PatternLike = { ...weekly, validFrom: "2026-08-20", validTo: null };
    const out = expandPatterns([kort], weeklyDays, "2026-08-17", "2026-08-21");
    expect(out.map((w) => w.date)).toEqual(["2026-08-20", "2026-08-21"]);
  });
});

describe("CompositeWorkDayProvider", () => {
  function stub(name: string, result: WorkDayResult): WorkDayProvider {
    return { name, getWorkDays: async () => result };
  }

  it("faller tillbaka per person, inte för alla på en gång", async () => {
    const primary = stub("transpa", {
      workDays: [{ employeeId: "e1", date: "2026-08-17", shift: "day" }],
      covered: ["e1"],
    });
    const fallback = stub("lokal", {
      workDays: [
        { employeeId: "e1", date: "2026-08-18", shift: "day" },
        { employeeId: "e2", date: "2026-08-18", shift: "night" },
      ],
      covered: ["e1", "e2"],
    });

    const out = await new CompositeWorkDayProvider([primary, fallback]).getWorkDays(
      ["e1", "e2"],
      "2026-08-17",
      "2026-08-21",
    );

    // e1 kommer från TransPA och ska inte kompletteras ur mönstret.
    expect(out.workDays).toEqual([
      { employeeId: "e1", date: "2026-08-17", shift: "day" },
      { employeeId: "e2", date: "2026-08-18", shift: "night" },
    ]);
    expect(out.covered.sort()).toEqual(["e1", "e2"]);
  });

  it("hittar inte på dagar åt någon som källan vet är ledig", async () => {
    // TransPA känner e1 men säger att hen inte jobbar alls den veckan.
    const primary = stub("transpa", { workDays: [], covered: ["e1"] });
    const fallback = stub("lokal", {
      workDays: [{ employeeId: "e1", date: "2026-08-18", shift: "day" }],
      covered: ["e1"],
    });

    const out = await new CompositeWorkDayProvider([primary, fallback]).getWorkDays(
      ["e1"],
      "2026-08-17",
      "2026-08-21",
    );
    expect(out.workDays).toEqual([]);
  });
});
