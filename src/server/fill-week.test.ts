import { describe, expect, it } from "vitest";
import { planWeek, type BaseScheduleEntry, type ExistingAssignment } from "./fill-week";
import type { WorkDay } from "@/lib/work-days";

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
const [MON, TUE, WED, THU, FRI] = WEEK;

function base(over: Partial<BaseScheduleEntry> & Pick<BaseScheduleEntry, "boardRowId" | "employeeId">): BaseScheduleEntry {
  return { shift: "day", validFrom: null, validTo: null, sortOrder: 0, ...over };
}

const work = (employeeId: string, dates: string[], shift: WorkDay["shift"] = "day"): WorkDay[] =>
  dates.map((date) => ({ employeeId, date, shift }));

describe("planWeek", () => {
  /**
   * Fallet ur era fjärrblad: BT13/14 körs av Björn måndag, tisdag,
   * torsdag, fredag och av Roger onsdag. Ingen har skrivit in det per
   * dag — båda är kopplade till bilen och deras arbetsdagar avgör.
   */
  it("bemannar en bil av två personer utifrån deras arbetsdagar", () => {
    const plan = planWeek({
      workDays: [...work("bjorn", [MON, TUE, THU, FRI]), ...work("roger", [WED])],
      baseSchedule: [
        base({ boardRowId: "bt1314", employeeId: "bjorn" }),
        base({ boardRowId: "bt1314", employeeId: "roger" }),
      ],
      existing: [],
      dates: WEEK,
    });

    expect(plan.create.map((c) => [c.date, c.employeeId])).toEqual([
      [MON, "bjorn"],
      [TUE, "bjorn"],
      [WED, "roger"],
      [THU, "bjorn"],
      [FRI, "bjorn"],
    ]);
    expect(plan.create.every((c) => c.boardRowId === "bt1314" && c.slot === 0)).toBe(true);
    expect(plan.unplaced).toEqual([]);
  });

  it("håller dag- och nattpass isär", () => {
    const plan = planWeek({
      workDays: [...work("elin", [MON], "day"), ...work("peter", [MON], "night")],
      baseSchedule: [
        base({ boardRowId: "bt0809", employeeId: "elin", shift: "day" }),
        base({ boardRowId: "bt0809", employeeId: "peter", shift: "night" }),
      ],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create).toEqual([
      { boardRowId: "bt0809", date: MON, shift: "day", slot: 0, employeeId: "elin" },
      { boardRowId: "bt0809", date: MON, shift: "night", slot: 0, employeeId: "peter" },
    ]);
  });

  it("listar den som jobbar men saknar bil", () => {
    const plan = planWeek({
      workDays: work("max", [MON, TUE]),
      baseSchedule: [],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create).toEqual([]);
    expect(plan.unplaced).toEqual([
      { employeeId: "max", date: MON, shift: "day" },
      { employeeId: "max", date: TUE, shift: "day" },
    ]);
  });

  it("respekterar bas-schemats giltighetsperiod", () => {
    const plan = planWeek({
      workDays: work("bjorn", [MON, WED, FRI]),
      baseSchedule: [
        base({ boardRowId: "gammal", employeeId: "bjorn", validTo: TUE }),
        base({ boardRowId: "ny", employeeId: "bjorn", validFrom: WED }),
      ],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create.map((c) => [c.date, c.boardRowId])).toEqual([
      [MON, "gammal"],
      [WED, "ny"],
      [FRI, "ny"],
    ]);
  });

  describe("handpåläggning", () => {
    const manualOnTue: ExistingAssignment = {
      id: "m1",
      boardRowId: "bt2426",
      date: TUE,
      shift: "day",
      slot: 0,
      employeeId: "bjorn",
      source: "manual",
    };

    it("rör inte ett pass som någon flyttat för hand", () => {
      const plan = planWeek({
        workDays: work("bjorn", [MON, TUE]),
        baseSchedule: [base({ boardRowId: "bt1314", employeeId: "bjorn" })],
        existing: [manualOnTue],
        dates: WEEK,
      });
      // Tisdagen står kvar där planeraren satte den, bara måndagen genereras.
      expect(plan.deleteIds).toEqual([]);
      expect(plan.create.map((c) => [c.date, c.boardRowId])).toEqual([[MON, "bt1314"]]);
    });

    it("lägger genererade pass bredvid ett handpålagt i samma cell", () => {
      const plan = planWeek({
        workDays: work("roger", [TUE]),
        baseSchedule: [base({ boardRowId: "bt2426", employeeId: "roger" })],
        existing: [manualOnTue],
        dates: WEEK,
      });
      expect(plan.create[0].slot).toBe(1);
    });

    it("städar bort sina egna gamla pass men inte andras", () => {
      const stale: ExistingAssignment = {
        id: "g1",
        boardRowId: "bt1314",
        date: MON,
        shift: "day",
        slot: 0,
        employeeId: "bjorn",
        source: "generated",
      };
      const plan = planWeek({
        workDays: [],
        baseSchedule: [],
        existing: [stale, manualOnTue],
        dates: WEEK,
      });
      expect(plan.deleteIds).toEqual(["g1"]);
    });
  });

  it("ger samma resultat två körningar i rad", () => {
    const args = {
      workDays: [...work("bjorn", [MON, TUE, THU, FRI]), ...work("roger", [WED])],
      baseSchedule: [
        base({ boardRowId: "bt1314", employeeId: "bjorn" }),
        base({ boardRowId: "bt1314", employeeId: "roger" }),
      ],
      dates: WEEK,
    };
    const first = planWeek({ ...args, existing: [] });

    // Andra körningen ser resultatet av den första som genererade pass.
    const asExisting: ExistingAssignment[] = first.create.map((c, i) => ({
      id: `g${i}`,
      boardRowId: c.boardRowId,
      date: c.date,
      shift: c.shift,
      slot: c.slot,
      employeeId: c.employeeId,
      source: "generated",
    }));
    const second = planWeek({ ...args, existing: asExisting });

    expect(second.create).toEqual(first.create);
    expect(second.deleteIds.sort()).toEqual(asExisting.map((a) => a.id).sort());
  });

  it("bryr sig inte om arbetsdagar utanför veckan", () => {
    const plan = planWeek({
      workDays: work("bjorn", ["2026-08-10", MON]),
      baseSchedule: [base({ boardRowId: "bt1314", employeeId: "bjorn" })],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create.map((c) => c.date)).toEqual([MON]);
  });
});

describe("frånvaro", () => {
  it("bemannar inte den som är ledig, och kallar hen inte ej utlagd", () => {
    const plan = planWeek({
      workDays: work("johan", [MON, TUE, WED]),
      baseSchedule: [base({ boardRowId: "bt2426", employeeId: "johan" })],
      existing: [],
      absences: [{ employeeId: "johan", fromDate: TUE, toDate: WED }],
      dates: WEEK,
    });
    expect(plan.create.map((c) => c.date)).toEqual([MON]);
    expect(plan.unplaced).toEqual([]);
  });
});
