import { describe, expect, it } from "vitest";
import { aliasCandidates, looksLikeName, normalizeAlias } from "./alias";

describe("normalizeAlias", () => {
  it("drar ihop skiftläge och blanksteg", () => {
    expect(normalizeAlias("  RASMUS   W ")).toBe("rasmus w");
    expect(normalizeAlias("Per H.")).toBe("per h");
  });
});

describe("looksLikeName", () => {
  it("känner igen smeknamnen ur schemat", () => {
    for (const n of ["Elle", "Per H", "RASMUS W", "Mylla", "Albert J"]) {
      expect(looksLikeName(n), n).toBe(true);
    }
  });

  it("avvisar noteringar som står i samma celler", () => {
    for (const n of ["###", "???", "Lastar själva", "Går nerifrån", "Inställd  V.28-31", "Dahl 4050"]) {
      expect(looksLikeName(n), n).toBe(false);
    }
  });
});

describe("aliasCandidates", () => {
  it("ger visningsnamn, signatur och förnamn+initial", () => {
    expect(
      aliasCandidates({
        firstName: "ANDREAS",
        lastName: "JAKOBSSON",
        displayAlias: "ANDREAS J",
        signature: "ANJA",
      }),
    ).toEqual(["ANDREAS J", "ANJA", "ANDREAS JAKOBSSON", "ANDREAS J", "ANDREAS"].filter((v, i, a) => a.indexOf(v) === i));
  });

  it("hoppar över tomma fält", () => {
    expect(aliasCandidates({ firstName: "Albin", lastName: "Hagberg" })).toEqual([
      "Albin Hagberg",
      "Albin H",
      "Albin",
    ]);
  });
});
