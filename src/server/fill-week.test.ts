import { describe, expect, it } from "vitest";
import { planWeek, type BaseScheduleEntry, type ExistingAssignment } from "./fill-week";
import type { WorkDay } from "@/lib/work-days";

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
const [MON, TUE, WED, THU, FRI] = WEEK;

/* id räknas upp av sig självt: de flesta testerna bryr sig inte om det,
   men planWeek behöver ett stabilt sista utslag när två rader är lika. */
let nextId = 0;
function base(
  over: Partial<BaseScheduleEntry> & Pick<BaseScheduleEntry, "boardRowId" | "employeeId">,
): BaseScheduleEntry {
  return {
    id: `bs${++nextId}`,
    shift: "day",
    validFrom: null,
    validTo: null,
    sortOrder: 0,
    ...over,
  };
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

/**
 * Det som var tyst fel.
 *
 * En person kopplad till två bilar hamnade på en av dem, vald ur en
 * osorterad databasläsning. Valet kunde alltså bli olika mellan två
 * tryck på "Fyll veckan" — personen bytte bil av sig själv, och den
 * andra bilen stod plötsligt obemannad utan att något sagt ifrån.
 */
describe("planWeek när flera bas-schemarader gäller", () => {
  const tva = () => [
    base({ id: "b-hog", boardRowId: "BT13", employeeId: "e1", sortOrder: 1 }),
    base({ id: "a-lag", boardRowId: "BT24", employeeId: "e1", sortOrder: 0 }),
  ];

  it("väljer den med lägst sortOrder, oavsett läsordning", () => {
    const framat = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: tva(),
      existing: [],
      dates: WEEK,
    });
    const bakat = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: tva().reverse(),
      existing: [],
      dates: WEEK,
    });

    expect(framat.create[0].boardRowId).toBe("BT24");
    expect(bakat.create[0].boardRowId).toBe("BT24");
  });

  it("nämner inget om tvetydighet när sortOrder skiljer dem åt", () => {
    expect(
      planWeek({ workDays: work("e1", [MON]), baseSchedule: tva(), existing: [], dates: WEEK })
        .ambiguous,
    ).toEqual([]);
  });

  /* Lika sortOrder betyder att ingen sagt vilken som gäller. Valet ska
     ändå vara detsamma varje gång — och det ska sägas ifrån. */
  it("väljer likadant varje gång när sortOrder är lika", () => {
    const lika = () => [
      base({ id: "z", boardRowId: "BT24", employeeId: "e1" }),
      base({ id: "a", boardRowId: "BT13", employeeId: "e1" }),
    ];
    const ett = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: lika(),
      existing: [],
      dates: WEEK,
    });
    const tva_ = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: lika().reverse(),
      existing: [],
      dates: WEEK,
    });

    expect(ett.create[0].boardRowId).toBe(tva_.create[0].boardRowId);
  });

  it("pekar ut tvetydigheten i stället för att gissa tyst", () => {
    const plan = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: [
        base({ id: "a", boardRowId: "BT13", employeeId: "e1" }),
        base({ id: "z", boardRowId: "BT24", employeeId: "e1" }),
      ],
      existing: [],
      dates: WEEK,
    });

    expect(plan.ambiguous).toEqual([
      { employeeId: "e1", date: MON, shift: "day", chosen: "BT13", alternatives: ["BT24"] },
    ]);
  });
});

describe("planWeek respekterar tavlan och raderna", () => {
  it("bemannar inte en rad som är inställd den dagen", () => {
    const plan = planWeek({
      workDays: work("e1", [MON, TUE]),
      baseSchedule: [base({ boardRowId: "BT13", employeeId: "e1" })],
      existing: [],
      rows: [{ id: "BT13", validFrom: null, validTo: MON }],
      dates: WEEK,
    });

    expect(plan.create.map((c) => c.date)).toEqual([MON]);
    // Tisdagen är inte en lucka i bemanningen — raden fanns inte då.
    expect(plan.unplaced.map((u) => u.date)).toEqual([TUE]);
  });

  /* Ett nattpass på en dagtavla har ingen cell att ligga i. Att lägga ut
     det ändå ger en rad i databasen som aldrig syns. */
  it("lägger inte ut ett skift tavlan inte visar", () => {
    const plan = planWeek({
      workDays: [...work("e1", [MON]), ...work("e1", [TUE], "night")],
      baseSchedule: [
        base({ boardRowId: "BT13", employeeId: "e1" }),
        base({ boardRowId: "BT13", employeeId: "e1", shift: "night" }),
      ],
      existing: [],
      visibleShifts: ["day"],
      dates: WEEK,
    });

    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].shift).toBe("day");
    expect(plan.hiddenShift).toEqual([{ employeeId: "e1", date: TUE, shift: "night" }]);
  });

  it("lägger ut båda skiften när tavlan visar dem", () => {
    const plan = planWeek({
      workDays: [...work("e1", [MON]), ...work("e1", [TUE], "night")],
      baseSchedule: [
        base({ boardRowId: "BT13", employeeId: "e1" }),
        base({ boardRowId: "BT13", employeeId: "e1", shift: "night" }),
      ],
      existing: [],
      visibleShifts: ["day", "night"],
      dates: WEEK,
    });

    expect(plan.create).toHaveLength(2);
    expect(plan.hiddenShift).toEqual([]);
  });
});
