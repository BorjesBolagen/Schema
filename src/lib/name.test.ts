import { describe, expect, it } from "vitest";
import { fullDisplayName, toDisplayName } from "./name";

describe("toDisplayName", () => {
  it("skriver om versalnamn", () => {
    expect(toDisplayName("PHILIP SORTTANEN")).toBe("Philip Sorttanen");
    expect(toDisplayName("BAHAA ALDIN SBAHI")).toBe("Bahaa Aldin Sbahi");
  });

  it("behåller bindestreck", () => {
    expect(toDisplayName("PER-OLA")).toBe("Per-Ola");
    expect(toDisplayName("BO-GÖRAN EINARSSON")).toBe("Bo-Göran Einarsson");
  });

  it("hanterar svenska tecken", () => {
    expect(toDisplayName("ÖRJAN BÄCKLUND")).toBe("Örjan Bäcklund");
    expect(toDisplayName("PER-OLA ROLÈN")).toBe("Per-Ola Rolèn");
  });

  it("rör inte namn som redan har blandad skiftning", () => {
    expect(toDisplayName("Albin Hagberg")).toBe("Albin Hagberg");
    expect(toDisplayName("Bo Göran Lundqvist")).toBe("Bo Göran Lundqvist");
  });
});

describe("fullDisplayName", () => {
  it("sätter ihop för- och efternamn", () => {
    expect(fullDisplayName({ firstName: "ANDREAS", lastName: "JAKOBSSON" })).toBe(
      "Andreas Jakobsson",
    );
  });
});
