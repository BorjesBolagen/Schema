import { describe, expect, it } from "vitest";
import { dragId, parseDragId, parseDropId } from "./dnd";

describe("dra och släpp-id", () => {
  it("skiljer en rad från en cell", () => {
    expect(parseDropId(dragId.row("r1"))).toEqual({ kind: "row", boardRowId: "r1" });
    expect(parseDropId(dragId.cell("r1", "2026-08-24", "day"))).toEqual({
      kind: "cell",
      boardRowId: "r1",
      date: "2026-08-24",
      shift: "day",
    });
  });

  /* Raden och cellen delar prefix-form men inte betydelse: raden lägger
     ut hela veckan, cellen en dag. En förväxling skulle göra att en
     dragning tyst gjorde fel sak. */
  it("tolkar inte en cell som en rad", () => {
    const cell = parseDropId(dragId.cell("r1", "2026-08-24", "night"));
    expect(cell?.kind).toBe("cell");
  });

  it("känner igen sidopanelen", () => {
    expect(parseDropId(dragId.crewPanel)).toEqual({ kind: "crew-panel" });
  });

  it("avvisar skräp i stället för att gissa", () => {
    expect(parseDropId("row:")).toBeNull();
    expect(parseDropId("cell:r1|2026-08-24|middag")).toBeNull();
    expect(parseDropId("nonsens")).toBeNull();
    expect(parseDragId("nonsens")).toBeNull();
  });

  it("bär personen och passet var för sig", () => {
    expect(parseDragId(dragId.crew("e1"))).toEqual({ kind: "crew", employeeId: "e1" });
    expect(parseDragId(dragId.assignment("a1"))).toEqual({ kind: "assignment", assignmentId: "a1" });
  });
});
