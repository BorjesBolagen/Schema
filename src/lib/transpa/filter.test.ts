import { describe, expect, it } from "vitest";
import { MAX_FILTER_LENGTH, batchByFilterLength, condition, joinConditions, overlapsRange } from "./filter";

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

describe("filterlängd", () => {
  /* Det verkliga fallet: GUID:er i ett $in tillsammans med två
     datumvillkor. Det var den kombinationen som gav
     "Filter is too long. Max length is 400 characters." i drift. */
  const guid = (n: number) => `07e9b5d1-83f0-489c-81c5-${String(n).padStart(12, "0")}`;
  const build = (batch: string[]) =>
    joinConditions([
      condition("employeeId", "in", batch),
      condition("startDateTime", "gte", "2026-07-15T05:00:00.000Z"),
      condition("startDateTime", "lt", "2026-08-26T05:00:00.000Z"),
    ]);

  it("håller varje färdigt filter under gränsen", () => {
    const ids = Array.from({ length: 50 }, (_, i) => guid(i));
    const batches = batchByFilterLength(ids, build);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(build(batch).length).toBeLessThanOrEqual(MAX_FILTER_LENGTH);
  });

  it("tappar ingen och dubblerar ingen", () => {
    const ids = Array.from({ length: 37 }, (_, i) => guid(i));
    expect(batchByFilterLength(ids, build).flat()).toEqual(ids);
  });

  it("packar så många som ryms, inte en i taget", () => {
    const ids = Array.from({ length: 20 }, (_, i) => guid(i));
    const [first] = batchByFilterLength(ids, build);

    expect(first.length).toBeGreaterThan(1);
    // Ett till skulle spränga gränsen — annars är packningen för gles.
    expect(build([...first, guid(999)]).length).toBeGreaterThan(MAX_FILTER_LENGTH);
  });

  it("skickar inget alls när listan är tom", () => {
    expect(batchByFilterLength([], build)).toEqual([]);
  });

  /* Ryms inte ens ett enda värde är det villkoren runt omkring som är
     för långa. Att dela upp hjälper inte, och ett tyst tomt svar skulle
     dölja orsaken. */
  it("säger ifrån när ett ensamt värde inte ryms", () => {
    const longWindow = (batch: string[]) => condition("employeeId", "in", batch) + "x".repeat(400);
    expect(() => batchByFilterLength([guid(1)], longWindow)).toThrowError(/högst 400/);
  });
});
