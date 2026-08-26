import { describe, expect, it } from "vitest";
import { localParts, shiftOfHour, suggestPatterns, type TripLike } from "./trip-patterns";

/** Turer för en person: en per angivet datum, med starttid i svensk lokaltid. */
function trips(employeeId: string, dates: string[], localHour = 7): TripLike[] {
  return dates.map((date) => {
    // Sommartid i Sverige är UTC+2, vintertid UTC+1.
    const summer = Number(date.slice(5, 7)) >= 4 && Number(date.slice(5, 7)) <= 9;
    const utcHour = localHour - (summer ? 2 : 1);
    const day = utcHour < 0 ? -1 : 0;
    const shifted = new Date(`${date}T00:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + day);
    const h = ((utcHour % 24) + 24) % 24;
    return {
      employeeId,
      startDateTime: `${shifted.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:30:00Z`,
    };
  });
}

/* Fyra hela veckor, måndag–fredag. */
const MON_FRI = [
  "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
  "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
  "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
  "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
];

describe("lokaltid", () => {
  /**
   * Turerna kommer i UTC. En tur som startar 00:30 svensk sommartid en
   * tisdag är 22:30Z på måndagen — läser man UTC rakt av hamnar den på
   * fel veckodag och fel skift.
   */
  it("flyttar en tur över midnatt till rätt svensk dag", () => {
    expect(localParts("2026-08-03T22:30:00Z")).toEqual({ date: "2026-08-04", hour: 0 });
  });

  it("skiljer sommartid från vintertid", () => {
    expect(localParts("2026-08-03T10:00:00Z").hour).toBe(12); // UTC+2
    expect(localParts("2026-01-05T10:00:00Z").hour).toBe(11); // UTC+1
  });

  it("delar dygnet i dag och natt", () => {
    expect(shiftOfHour(7)).toBe("day");
    expect(shiftOfHour(17)).toBe("day");
    expect(shiftOfHour(18)).toBe("night");
    expect(shiftOfHour(23)).toBe("night");
    expect(shiftOfHour(3)).toBe("night");
    expect(shiftOfHour(5)).toBe("day");
  });
});

describe("suggestPatterns", () => {
  it("föreslår måndag–fredag för den som kör måndag–fredag", () => {
    const [s] = suggestPatterns(trips("e1", MON_FRI));

    expect(s.weeksObserved).toBe(4);
    expect(s.confidence).toBe("hög");
    expect(s.days).toEqual([
      { weekday: 1, shift: "day" },
      { weekday: 2, shift: "day" },
      { weekday: 3, shift: "day" },
      { weekday: 4, shift: "day" },
      { weekday: 5, shift: "day" },
    ]);
    expect(s.uncertain).toEqual([]);
  });

  it("känner igen ett nattmönster", () => {
    const [s] = suggestPatterns(trips("e1", MON_FRI, 22));
    expect(s.days.every((d) => d.shift === "night")).toBe(true);
  });

  /**
   * Den viktigaste egenskapen: en dag som förekommer ibland ska inte
   * fyllas i åt planeraren. Ett tyst felaktigt mönster lägger ut fel
   * person på fel bil, och det är värre än en tom ruta.
   */
  it("föreslår inte en dag som bara förekommer ibland", () => {
    const irregular = [...MON_FRI, "2026-08-08", "2026-08-22"]; // lördag två av fyra veckor
    const [s] = suggestPatterns(trips("e1", irregular));

    expect(s.days.map((d) => d.weekday)).not.toContain(6);
    const saturday = s.uncertain.find((e) => e.weekday === 6)!;
    expect(saturday.weeksWorked).toBe(2);
    expect(saturday.share).toBe(0.5);
  });

  it("föreslår ingenting när underlaget är för tunt", () => {
    const [s] = suggestPatterns(trips("e1", ["2026-08-03", "2026-08-04"]));

    expect(s.weeksObserved).toBe(1);
    expect(s.confidence).toBe("otillräcklig");
    expect(s.days).toEqual([]);
    // Underlaget visas ändå — planeraren ska se vad som fanns.
    expect(s.evidence).toHaveLength(2);
  });

  it("räknar veckor, inte turer", () => {
    // Tre turer samma måndag är fortfarande en veckas bevis.
    const sameDay = ["2026-08-03", "2026-08-03", "2026-08-03", "2026-08-10", "2026-08-17"];
    const [s] = suggestPatterns(trips("e1", sameDay));

    expect(s.weeksObserved).toBe(3);
    expect(s.evidence[0].weeksWorked).toBe(3);
  });

  it("håller isär personer", () => {
    const result = suggestPatterns([...trips("e1", MON_FRI), ...trips("e2", MON_FRI, 22)]);

    expect(result).toHaveLength(2);
    expect(result[0].days[0].shift).toBe("day");
    expect(result[1].days[0].shift).toBe("night");
  });

  it("tål tomt underlag", () => {
    expect(suggestPatterns([])).toEqual([]);
  });
});
