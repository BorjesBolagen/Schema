import { describe, expect, it } from "vitest";
import {
  MAX_WINDOW_DAYS,
  SHIFTS_PATH,
  shiftToWorkDay,
  shiftWindow,
  splitIntoWindows,
  workDaysFromShifts,
} from "./shifts";

/**
 * Formen är bekräftad mot Börjes tenant, inte gissad: fälten kom ur ett
 * riktigt svar, och båda tidsgränserna visade sig obligatoriska.
 */
const shift = (startDateTime: string, employeeId = "T-1") => ({
  id: "s1",
  employeeId,
  startDateTime,
  adjustedWorkTimeInMinutes: 480,
  isExtraShift: false,
});

const local = (id: string) => (id === "T-1" ? "e1" : id === "T-2" ? "e2" : undefined);

describe("shiftWindow", () => {
  it("skickar båda gränserna, som API:t kräver", () => {
    const q = shiftWindow("2026-08-17", "2026-08-21");
    expect(Object.keys(q).sort()).toEqual(["startDateTimeAfter", "startDateTimeBefore"]);
  });

  /* API:t svarar 400 med "startDateTimeBefore has to be after
     startDateTimeAfter" när ordningen är fel. Det hände i skarp
     körning, och det får inte hända igen. */
  it("lägger den senare gränsen efter den tidigare", () => {
    const q = shiftWindow("2026-08-17", "2026-08-21");
    expect(new Date(q.startDateTimeBefore).getTime()).toBeGreaterThan(
      new Date(q.startDateTimeAfter).getTime(),
    );
  });

  it("håller ordningen även för en enda dag", () => {
    const q = shiftWindow("2026-08-17", "2026-08-17");
    expect(new Date(q.startDateTimeBefore).getTime()).toBeGreaterThan(
      new Date(q.startDateTimeAfter).getTime(),
    );
  });

  it("pekar på den bekräftade sökvägen, med snedstreck", () => {
    expect(SHIFTS_PATH).toBe("/v1/shifts/");
  });
});

describe("shiftToWorkDay", () => {
  it("läser dagen i svensk tid, inte i UTC", () => {
    // 22:30Z en måndag i augusti är tisdag 00:30 svensk sommartid.
    expect(shiftToWorkDay(shift("2026-08-17T22:30:00Z"), "e1")).toEqual({
      employeeId: "e1",
      date: "2026-08-18",
      shift: "night",
    });
  });

  it("skiljer dagpass från nattpass", () => {
    expect(shiftToWorkDay(shift("2026-08-17T05:00:00Z"), "e1")!.shift).toBe("day");
    expect(shiftToWorkDay(shift("2026-08-17T17:00:00Z"), "e1")!.shift).toBe("night");
  });

  it("ger inget för ett pass utan starttid", () => {
    expect(shiftToWorkDay({ id: "s1", employeeId: "T-1" }, "e1")).toBeNull();
  });

  it("ger inget för en starttid som inte går att läsa", () => {
    expect(shiftToWorkDay(shift("inte ett datum"), "e1")).toBeNull();
  });
});

describe("workDaysFromShifts", () => {
  it("översätter TransPA:s person-id till vårt", () => {
    const { workDays } = workDaysFromShifts([shift("2026-08-17T06:00:00Z", "T-2")], local);
    expect(workDays[0].employeeId).toBe("e2");
  });

  it("hoppar över pass för någon vi inte känner", () => {
    const { workDays, covered } = workDaysFromShifts([shift("2026-08-17T06:00:00Z", "OKÄND")], local);
    expect(workDays).toEqual([]);
    expect(covered).toEqual([]);
  });

  /* Två pass samma dag och skift — delat pass eller extrapass — är
     fortfarande en arbetsdag. */
  it("räknar två pass samma dag och skift som en dag", () => {
    const { workDays } = workDaysFromShifts(
      [shift("2026-08-17T06:00:00Z"), shift("2026-08-17T10:00:00Z")],
      local,
    );
    expect(workDays).toHaveLength(1);
  });

  it("räknar dag och natt samma dygn som två", () => {
    const { workDays } = workDaysFromShifts(
      [shift("2026-08-17T06:00:00Z"), shift("2026-08-17T18:00:00Z")],
      local,
    );
    expect(workDays.map((w) => w.shift).sort()).toEqual(["day", "night"]);
  });

  /**
   * Täckningen avgör om reservkällan får ta över. Den som inte har ett
   * enda pass lämnas otäckt och faller tillbaka på sitt lokala mönster
   * — hellre det än att en tom vecka tolkas som ledighet och tömmer
   * tavlan för någon vars pass inte förts in i TransPA.
   */
  it("täcker bara dem TransPA faktiskt sagt något om", () => {
    const { covered } = workDaysFromShifts([shift("2026-08-17T06:00:00Z", "T-1")], local);
    expect(covered).toEqual(["e1"]);
  });

  it("tål en tom lista", () => {
    expect(workDaysFromShifts([], local)).toEqual({ workDays: [], covered: [] });
  });
});

/**
 * TransPA tar högst 31 dagar per anrop: "startDateTimeAfter and
 * startDateTimeBefore needs to be within 31 days". Synken bad om sexton
 * veckor och fick just det svaret.
 */
describe("splitIntoWindows", () => {
  const span = (w: { from: string; to: string }) =>
    (new Date(`${w.to}T00:00:00Z`).getTime() - new Date(`${w.from}T00:00:00Z`).getTime()) / 86_400_000;

  it("lämnar ett kort intervall i en bit", () => {
    expect(splitIntoWindows("2026-08-17", "2026-08-28")).toEqual([
      { from: "2026-08-17", to: "2026-08-28" },
    ]);
  });

  it("delar sexton veckor i bitar API:t accepterar", () => {
    const windows = splitIntoWindows("2026-08-01", "2026-11-21");

    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) expect(span(w)).toBeLessThan(31);
  });

  /* Ett glapp skulle tappa pass, ett överlapp skulle hämta dem två
     gånger. Bitarna ska gränsa exakt. */
  it("lämnar varken glapp eller överlapp", () => {
    const windows = splitIntoWindows("2026-08-01", "2026-11-21");

    for (let i = 1; i < windows.length; i++) {
      const föregåendeSlut = new Date(`${windows[i - 1].to}T00:00:00Z`).getTime();
      const dettaStart = new Date(`${windows[i].from}T00:00:00Z`).getTime();
      expect(dettaStart - föregåendeSlut).toBe(86_400_000);
    }
  });

  it("täcker hela intervallet, från första till sista dagen", () => {
    const windows = splitIntoWindows("2026-08-01", "2026-11-21");
    expect(windows[0].from).toBe("2026-08-01");
    expect(windows[windows.length - 1].to).toBe("2026-11-21");
  });

  it("klarar en enda dag", () => {
    expect(splitIntoWindows("2026-08-17", "2026-08-17")).toEqual([
      { from: "2026-08-17", to: "2026-08-17" },
    ]);
  });

  it("ger inget för ett bakvänt eller obegripligt intervall", () => {
    expect(splitIntoWindows("2026-08-28", "2026-08-17")).toEqual([]);
    expect(splitIntoWindows("inte ett datum", "2026-08-17")).toEqual([]);
  });

  it("håller sig under API:ts gräns med marginal", () => {
    expect(MAX_WINDOW_DAYS).toBeLessThan(31);
  });
});
