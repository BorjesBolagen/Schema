import { describe, expect, it } from "vitest";
import { buildAliasIndex, resolveCellText, splitPair } from "./resolve";

const { index, ambiguous } = buildAliasIndex([
  { id: "e-albin", candidates: ["Albin Lundberg", "Albin L", "Albin"] },
  { id: "e-casper", candidates: ["CASPER R", "Casper Rydell"] },
  { id: "e-anders-h", candidates: ["Anders Håkansson", "Anders H", "Anders"] },
  { id: "e-anders-n", candidates: ["Anders Nilsson", "Anders N", "Anders"] },
]);

describe("buildAliasIndex", () => {
  it("markerar smeknamn som flera personer delar som tvetydiga", () => {
    expect(index.get("anders")).toBeNull();
    expect([...ambiguous.get("anders")!].sort()).toEqual(["e-anders-h", "e-anders-n"]);
  });

  it("behåller de entydiga", () => {
    expect(index.get("anders h")).toBe("e-anders-h");
    expect(index.get("albin l")).toBe("e-albin");
  });
});

describe("resolveCellText", () => {
  it("plockar namnet och behåller resten som notering", () => {
    expect(resolveCellText("Albin L Sjuk", index)).toEqual({
      kind: "employee",
      employeeId: "e-albin",
      matched: "Albin L",
      note: "Sjuk",
    });
    expect(resolveCellText("CASPER R BT23-->", index)).toMatchObject({
      employeeId: "e-casper",
      note: "BT23-->",
    });
  });

  it("tar det längsta namnet, inte det första som råkar matcha", () => {
    expect(resolveCellText("Anders H", index)).toMatchObject({ employeeId: "e-anders-h" });
  });

  it("vägrar gissa när smeknamnet är tvetydigt", () => {
    expect(resolveCellText("Anders", index)).toEqual({
      kind: "unresolved",
      alias: "Anders",
      note: "Anders",
      reason: "ambiguous",
    });
  });

  it("behandlar celltexter som inte är namn som noteringar", () => {
    expect(resolveCellText("Lastar själva", index)).toEqual({ kind: "note", note: "Lastar själva" });
    expect(resolveCellText("Inställd  V.28-31", index)).toMatchObject({ kind: "note" });
    expect(resolveCellText("###", index)).toEqual({ kind: "note", note: "###" });
  });

  it("listar okända namn för granskning", () => {
    expect(resolveCellText("Mylla", index)).toEqual({
      kind: "unresolved",
      alias: "Mylla",
      note: "Mylla",
      reason: "unknown",
    });
  });
});

describe("splitPair", () => {
  it("delar delade turer", () => {
    expect(splitPair("Dahl/Leffe")).toEqual(["Dahl", "Leffe"]);
    expect(splitPair("JOHAN/FANNY")).toEqual(["JOHAN", "FANNY"]);
  });

  it("delar inte bilnummerpar eller vanliga celler", () => {
    expect(splitPair("4030/4050")).toBeNull();
    expect(splitPair("Elle")).toBeNull();
    expect(splitPair("a/b/c")).toBeNull();
  });
});
