import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("skriver om svenska tecken i stället för att tappa dem", () => {
    expect(slugify("Fjärr Växjö")).toBe("fjarr-vaxjo");
    expect(slugify("Åsa Öberg")).toBe("asa-oberg");
  });

  it("klarar skiljetecken och kanter", () => {
    expect(slugify("  Fjärr Nybro / Hultsfred  ")).toBe("fjarr-nybro-hultsfred");
    expect(slugify("BT08/09")).toBe("bt08-09");
    expect(slugify("???")).toBe("");
  });
});

describe("uniqueSlug", () => {
  it("lämnar en ledig slug i fred", () => {
    expect(uniqueSlug("fjarr", ["annat"])).toBe("fjarr");
  });

  it("räknar upp när slugen är tagen", () => {
    expect(uniqueSlug("fjarr", ["fjarr"])).toBe("fjarr-2");
    expect(uniqueSlug("fjarr", ["fjarr", "fjarr-2"])).toBe("fjarr-3");
  });

  it("faller tillbaka på ett namn när slugen blev tom", () => {
    expect(uniqueSlug("", [])).toBe("tavla");
  });
});
