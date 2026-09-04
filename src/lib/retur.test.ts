import { describe, expect, it } from "vitest";
import { internReturväg } from "./retur";

/**
 * Inloggningens ?retur=.
 *
 * Regeln som stod i logga-in/page.tsx var "börjar med / men inte //".
 * Den ser heltäckande ut och är det inte: webbläsare gör om bakstreck
 * till snedstreck i en adress, så snedstreck-bakstreck-värd blir en
 * protokollrelativ adress till någon annan. Då är inloggningen en
 * vidarebefordran med Börjes domän i adressfältet ända fram till
 * hoppet — precis vad en nätfiskelänk vill ha.
 */
describe("internReturväg", () => {
  it("släpper igenom en vanlig intern väg med frågesträng", () => {
    expect(internReturväg("/tavla/fjarr-nybro?ar=2026&vecka=36")).toBe(
      "/tavla/fjarr-nybro?ar=2026&vecka=36",
    );
  });

  it("släpper igenom startsidan", () => {
    expect(internReturväg("/")).toBe("/");
  });

  it("stoppar en protokollrelativ adress", () => {
    expect(internReturväg("//ondsajt.se")).toBe("/");
    expect(internReturväg("//ondsajt.se/tavla")).toBe("/");
  });

  /* Det hål den gamla regeln hade. Den prövade bara två snedstreck. */
  it("stoppar bakstreck efter det första snedstrecket", () => {
    expect(internReturväg("/\\ondsajt.se")).toBe("/");
    expect(internReturväg("/\\\\ondsajt.se")).toBe("/");
  });

  it("stoppar bakstreck var som helst i vägen", () => {
    expect(internReturväg("/tavla/\\\\ondsajt.se")).toBe("/");
  });

  it("stoppar radbrott och tabb, som annars kan dela Location-rubriken", () => {
    expect(internReturväg("/tavla\nLocation: https://ondsajt.se")).toBe("/");
    expect(internReturväg("/tavla\r\nSet-Cookie: x=1")).toBe("/");
    expect(internReturväg("/tavla\tx")).toBe("/");
  });

  it("stoppar en absolut adress", () => {
    expect(internReturväg("https://ondsajt.se")).toBe("/");
    expect(internReturväg("ondsajt.se")).toBe("/");
  });

  it("faller tillbaka på startsidan när inget angetts", () => {
    expect(internReturväg(null)).toBe("/");
    expect(internReturväg(undefined)).toBe("/");
    expect(internReturväg("")).toBe("/");
  });
});
