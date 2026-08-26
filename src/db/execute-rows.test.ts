import { describe, expect, it } from "vitest";
import { rowsFromExecute } from "./index";

/**
 * db.execute() returnerar olika saker beroende på drivrutin: postgres-js
 * ger en array, PGlite ger { rows }. Skillnaden syns inte i typerna, och
 * en destrukturering av resultatet fungerade därför i produktion men
 * kraschade lokalt med "(intermediate value) is not iterable" — tavlan
 * gick inte att öppna alls.
 */
describe("rowsFromExecute", () => {
  it("läser en array, som postgres-js ger", () => {
    expect(rowsFromExecute<{ a: number }>([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("läser { rows }, som PGlite ger", () => {
    expect(rowsFromExecute<{ a: number }>({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it("ger tom lista i stället för att krascha på något oväntat", () => {
    expect(rowsFromExecute(null)).toEqual([]);
    expect(rowsFromExecute(undefined)).toEqual([]);
    expect(rowsFromExecute({})).toEqual([]);
    expect(rowsFromExecute({ rows: "nej" })).toEqual([]);
  });
});
