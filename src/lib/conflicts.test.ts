import { describe, expect, it } from "vitest";
import { detectBookingConflicts, detectShiftMismatch, detectUnmanned, indexConflicts, type AssignmentLike } from "./conflicts";

const DATES = ["2026-08-03", "2026-08-04"];

function a(over: Partial<AssignmentLike> & Pick<AssignmentLike, "id">): AssignmentLike {
  return {
    boardRowId: "row-1",
    date: DATES[0],
    shift: "day",
    slot: 0,
    employeeId: null,
    vehicleId: null,
    boardId: "b1",
    boardName: "Fjärr",
    rowLabel: "BT08/09",
    ...over,
  };
}

describe("detectBookingConflicts", () => {
  it("hittar samma förare på två rader samma dag", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", employeeId: "e1" }),
        a({ id: "2", employeeId: "e1", boardRowId: "row-2", rowLabel: "BT13/14" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c).toEqual([
      {
        kind: "double-booked",
        date: DATES[0],
        employeeId: "e1",
        assignmentIds: ["1", "2"],
        places: ["Fjärr: BT08/09", "Fjärr: BT13/14"],
      },
    ]);
  });

  it("hittar krocken även när raderna ligger på olika tavlor", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", employeeId: "e1" }),
        a({ id: "2", employeeId: "e1", boardId: "b2", boardName: "Lots", boardRowId: "row-9" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c[0]).toMatchObject({ kind: "double-booked", places: ["Fjärr: BT08/09", "Lots: BT08/09"] });
  });

  it("räknar inte delad tur som bilkrock — båda förarna kör samma bil", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", employeeId: "e1", vehicleId: "v1", slot: 0 }),
        a({ id: "2", employeeId: "e2", vehicleId: "v1", slot: 1 }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c.filter((x) => x.kind === "vehicle-clash")).toHaveLength(0);
  });

  it("hittar samma bil på två olika rader", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", vehicleId: "v1" }),
        a({ id: "2", vehicleId: "v1", boardRowId: "row-2", rowLabel: "BT13/14" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c[0]).toMatchObject({ kind: "vehicle-clash", vehicleId: "v1" });
  });

  it("flaggar förare som är inplanerad under sin frånvaro", () => {
    const c = detectBookingConflicts({
      assignments: [a({ id: "1", employeeId: "e1", date: DATES[1] })],
      absences: [{ employeeId: "e1", fromDate: DATES[0], toDate: DATES[1], type: "semester" }],
      dates: DATES,
    });
    expect(c).toEqual([
      { kind: "absent", date: DATES[1], employeeId: "e1", assignmentId: "1", absenceType: "semester" },
    ]);
  });

});

describe("skift", () => {
  it("räknar inte samma bil på dag och natt som krock — det är poängen med skiften", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", vehicleId: "v1", shift: "day", boardRowId: "row-1" }),
        a({ id: "2", vehicleId: "v1", shift: "night", boardRowId: "row-2" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c.filter((x) => x.kind === "vehicle-clash")).toHaveLength(0);
  });

  it("hittar samma bil på två rader inom samma skift", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", vehicleId: "v1", shift: "night", boardRowId: "row-1" }),
        a({ id: "2", vehicleId: "v1", shift: "night", boardRowId: "row-2" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c[0]).toMatchObject({ kind: "vehicle-clash", vehicleId: "v1" });
  });

  it("varnar mildare när en person har både dag- och nattpass samma dygn", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", employeeId: "e1", shift: "day" }),
        a({ id: "2", employeeId: "e1", shift: "night", boardRowId: "row-2" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c.map((x) => x.kind)).toEqual(["day-and-night"]);
  });

  it("men två pass på samma skift är fortfarande en dubbelbokning", () => {
    const c = detectBookingConflicts({
      assignments: [
        a({ id: "1", employeeId: "e1", shift: "night" }),
        a({ id: "2", employeeId: "e1", shift: "night", boardRowId: "row-2" }),
      ],
      absences: [],
      dates: DATES,
    });
    expect(c.map((x) => x.kind)).toEqual(["double-booked"]);
  });
});

describe("detectUnmanned", () => {
  it("pekar ut tomma celler men inte rader som slutat gälla", () => {
    const c = detectUnmanned([
      {
        rows: [
          { id: "row-1", validFrom: null, validTo: null },
          { id: "row-2", validFrom: null, validTo: DATES[0] },
        ],
        dates: DATES,
        shifts: ["day"],
        assignments: [a({ id: "1", boardRowId: "row-1", date: DATES[0] })],
      },
    ]);
    expect(c).toEqual([
      { kind: "unmanned", date: DATES[0], boardRowId: "row-2", shift: "day" },
      { kind: "unmanned", date: DATES[1], boardRowId: "row-1", shift: "day" },
    ]);
  });

  it("larmar bara för de datum tavlan visar", () => {
    const c = detectUnmanned([
      {
        rows: [{ id: "row-1", validFrom: null, validTo: null }],
        dates: [DATES[0]],
        shifts: ["day"],
        assignments: [],
      },
    ]);
    expect(c).toHaveLength(1);
  });
});

describe("indexConflicts", () => {
  it("gör konflikterna uppslagbara per tilldelning och per tom cell", () => {
    const conflicts = [
      ...detectBookingConflicts({
        assignments: [
          a({ id: "1", employeeId: "e1" }),
          a({ id: "2", employeeId: "e1", boardRowId: "row-2" }),
        ],
        absences: [],
        dates: [DATES[0]],
      }),
      ...detectUnmanned([
        {
          rows: [{ id: "row-3", validFrom: null, validTo: null }],
          dates: [DATES[0]],
          shifts: ["day"],
          assignments: [],
        },
      ]),
    ];
    const idx = indexConflicts(conflicts);
    expect(idx.byAssignment.get("1")?.[0].kind).toBe("double-booked");
    expect(idx.byAssignment.get("2")?.[0].kind).toBe("double-booked");
    expect(idx.byCell.get(`row-3|${DATES[0]}|day`)?.[0].kind).toBe("unmanned");
  });
});

/**
 * Den vanligaste feltypen när ett schema förs över för hand: någon
 * läggs på dagraden fast TransPA har hen planerad på natt. Källan vet
 * vilket, och det är värt att säga ifrån innan veckan delas ut.
 */
describe("detectShiftMismatch", () => {
  const placed = (shift: "day" | "night", date = "2026-08-17") => ({
    id: `a-${shift}-${date}`,
    boardRowId: "r1",
    date,
    shift,
    slot: 0,
    employeeId: "e1",
    vehicleId: null,
    boardId: "b1",
    boardName: "Fjärr",
    rowLabel: "BT08/09",
  });

  it("flaggar den som står på dag men är planerad på natt", () => {
    const found = detectShiftMismatch({
      assignments: [placed("day")],
      workDays: [{ employeeId: "e1", date: "2026-08-17", shift: "night" }],
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "shift-mismatch", placed: "day", planned: "night" });
  });

  it("flaggar också åt andra hållet", () => {
    const found = detectShiftMismatch({
      assignments: [placed("night")],
      workDays: [{ employeeId: "e1", date: "2026-08-17", shift: "day" }],
    });
    expect(found[0]).toMatchObject({ placed: "night", planned: "day" });
  });

  it("säger inget när skiftet stämmer", () => {
    expect(
      detectShiftMismatch({
        assignments: [placed("day")],
        workDays: [{ employeeId: "e1", date: "2026-08-17", shift: "day" }],
      }),
    ).toEqual([]);
  });

  /* Saknas passet vet vi ingenting om dagen, och tystnad är inget fel.
     Annars skulle varje person utan TransPA-koppling flaggas. */
  it("säger inget om en dag källan saknar besked om", () => {
    expect(
      detectShiftMismatch({
        assignments: [placed("day", "2026-08-19")],
        workDays: [{ employeeId: "e1", date: "2026-08-17", shift: "night" }],
      }),
    ).toEqual([]);
  });

  /* Har någon både dag- och nattpass samma dygn är ingendera fel — det
     fångas i stället av day-and-night. */
  it("säger inget när personen har både dag och natt samma dygn", () => {
    expect(
      detectShiftMismatch({
        assignments: [placed("day")],
        workDays: [
          { employeeId: "e1", date: "2026-08-17", shift: "day" },
          { employeeId: "e1", date: "2026-08-17", shift: "night" },
        ],
      }),
    ).toEqual([]);
  });

  it("bryr sig inte om tomma celler", () => {
    expect(
      detectShiftMismatch({
        assignments: [{ ...placed("day"), employeeId: null }],
        workDays: [{ employeeId: "e1", date: "2026-08-17", shift: "night" }],
      }),
    ).toEqual([]);
  });
});
