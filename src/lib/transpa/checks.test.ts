import { describe, expect, it } from "vitest";
import { CHECKS, checkById, costLabel } from "./checks";

/**
 * Kontrollerna är sidans hela skydd mot att äta upp kvoten igen. Det
 * som provas är att de faktiskt är avgränsade — en "liten" kontroll som
 * i själva verket sveper är värre än ingen alls, eftersom den ser
 * ofarlig ut.
 */

describe("CHECKS", () => {
  it("har unika id:n", () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
  });

  it("håller alla utom svepningen under en handfull anrop", () => {
    for (const c of CHECKS.filter((c) => c.id !== "allt")) {
      expect(c.calls).toBeLessThanOrEqual(3);
    }
  });

  /* Det dyra ska vara valbart, inte förvalt — och tydligt märkt. */
  it("har svepningen som ett eget val", () => {
    const allt = checkById("allt")!;
    expect(allt.selection.paths).toBe("alla");
    expect(costLabel(allt)).toContain("~");
  });

  it("stänger av allt utom det valda i de små kontrollerna", () => {
    for (const c of CHECKS.filter((c) => c.id !== "allt")) {
      expect(c.selection.trips).toBe(false);
      expect(c.selection.grouping).toBe(false);
      expect(c.selection.shiftVariants).toBe(false);
    }
  });

  /* Passvägen under en person kräver ett riktigt id, annars svarar den
     404 oavsett om vägen finns. */
  it("hämtar en person när kontrollen behöver ett id", () => {
    const pass = checkById("pass")!;
    expect(pass.selection.sampleEmployee).toBe(true);
    expect(pass.selection.paths).toContain("/v1/employees/{id}/shifts/");
  });

  it("räknar spec-läsningen som gratis mot API:t", () => {
    expect(costLabel(checkById("spec")!)).toBe("inga API-anrop");
  });

  it("ger undefined för ett okänt id", () => {
    expect(checkById("finns-inte")).toBeUndefined();
    expect(checkById(undefined)).toBeUndefined();
  });
});
