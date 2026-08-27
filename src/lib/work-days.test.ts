import { describe, expect, it } from "vitest";
import {
  CompositeWorkDayProvider,
  type WorkDayProvider,
  type WorkDayResult,
} from "./work-days";

/**
 * Cykelberäkningen och mönsterexpansionen är borttagna med
 * arbetsmönstren. Kvar står kedjan: den behövs så snart det finns mer
 * än en källa, och dess viktigaste egenskap — att falla tillbaka per
 * person i stället för som ett omkast — är värd att hålla kvar även med
 * en enda källa i dag.
 */

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
