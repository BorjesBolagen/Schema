import { describe, expect, it } from "vitest";
import { condition, joinConditions, overlapsRange } from "./filter";

describe("filtersyntaxen", () => {
  it("skriver ett enkelt villkor", () => {
    expect(condition("id", "eq", "07e9b5d1")).toBe("id$eq:07e9b5d1");
  });

  it("skriver listor inom hakparenteser", () => {
    expect(condition("employeeId", "in", ["a", "b"])).toBe("employeeId$in:[a,b]");
    expect(condition("employeeId", "nin", ["a"])).toBe("employeeId$nin:[a]");
  });

  it("vägrar en lista till en jämförare som tar ett värde", () => {
    expect(() => condition("id", "eq", ["a", "b"])).toThrow(/ett enda värde/);
  });

  it("kopplar ihop villkor", () => {
    expect(joinConditions([condition("id", "eq", "1"), condition("status", "eq", "approved")]))
      .toBe("id$eq:1$and:status$eq:approved");
    expect(joinConditions([condition("a", "eq", "1"), condition("b", "eq", "2")], "or"))
      .toBe("a$eq:1$or:b$eq:2");
  });

  it("hoppar över tomma villkor", () => {
    expect(joinConditions([condition("a", "eq", "1"), ""])).toBe("a$eq:1");
  });

  it("bygger ett spannvillkor", () => {
    expect(overlapsRange("startDateTime", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z")).toBe(
      "startDateTime$gte:2026-08-01T00:00:00Z$and:startDateTime$lt:2026-09-01T00:00:00Z",
    );
  });
});
