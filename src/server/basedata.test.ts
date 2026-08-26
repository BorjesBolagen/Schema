import { describe, expect, it } from "vitest";
import { describePattern } from "./basedata";

const days = (weekdays: number[], shift = "day") =>
  weekdays.map((weekday) => ({ weekday, shift }));

/**
 * Raden i personallistan avgör vem som behöver ett mönster satt. Är den
 * missvisande sätter någon om ett mönster som redan stämde — eller
 * låter bli att sätta ett som saknas.
 */
describe("describePattern", () => {
  it("skriver sammanhängande dagar som ett spann", () => {
    expect(describePattern(1, days([1, 2, 3, 4, 5]))).toBe("mån–fre ☀️");
  });

  it("räknar upp dagar som inte hänger ihop", () => {
    expect(describePattern(1, days([1, 3, 5]))).toBe("mån, ons, fre ☀️");
  });

  it("läser veckan från måndag, inte från söndag", () => {
    // Söndagen hör till slutet av veckan i ett schema, inte till början.
    expect(describePattern(1, days([0, 5, 6]))).toBe("fre–sön ☀️");
  });

  it("visar nattskift", () => {
    expect(describePattern(1, days([1, 2, 3, 4], "night"))).toBe("mån–tors 🌙");
  });

  it("visar att både dag och natt förekommer", () => {
    expect(describePattern(1, [...days([1, 2]), ...days([3], "night")])).toBe("mån–ons ☀️🌙");
  });

  /* En rullande cykel går inte att sammanfatta ärligt på en rad, och en
     halvsanning är värre än en hänvisning till redigeraren. */
  it("beskriver inte en längre cykel i detalj", () => {
    expect(describePattern(4, days([1, 2, 3]))).toBe("4 v. cykel");
  });

  it("skiljer ett tomt mönster från inget mönster", () => {
    expect(describePattern(1, [])).toBe("inga dagar");
  });

  it("skriver två dagar som uppräkning, inte som spann", () => {
    expect(describePattern(1, days([1, 2]))).toBe("mån, tis ☀️");
  });
});
