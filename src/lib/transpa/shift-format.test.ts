import { describe, expect, it } from "vitest";
import { shiftWindow } from "./shifts";

/**
 * Fönstret frågas i svenska kalenderdagar men jämförs mot UTC hos
 * TransPA, och det är en dags marginal i vardera riktningen som får de
 * två att gå ihop.
 *
 * Marginalen fanns tidigare bara i kommentaren. Koden satte gränserna
 * rakt på midnatt UTC, vilket på sommaren är 02:00 svensk tid — så ett
 * nattpass som började 00:30 på veckans första dag hämtades aldrig.
 * Just de passen är hela poängen med att hämta scheman.
 */
describe("fönstret för ett uppslag", () => {
  const q = shiftWindow("2026-08-17", "2026-08-28");
  const inom = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= new Date(q.startDateTimeAfter).getTime() && t <= new Date(q.startDateTimeBefore).getTime();
  };

  it("börjar ett dygn före första dagen", () => {
    expect(q.startDateTimeAfter).toBe("2026-08-16T00:00:00.000Z");
  });

  it("sträcker sig förbi slutet av sista dagen", () => {
    expect(q.startDateTimeBefore).toBe("2026-08-30T00:00:00.000Z");
  });

  it("täcker ett pass som börjar sent på slutdagen", () => {
    // 23:00 svensk tid den 28:e är 21:00Z.
    expect(inom("2026-08-28T21:00:00Z")).toBe(true);
  });

  /* Det som föll bort förut: natten till första dagen. */
  it("täcker ett pass som börjar strax efter midnatt på första dagen", () => {
    // 00:30 svensk sommartid den 17:e är 22:30Z den 16:e.
    expect(inom("2026-08-16T22:30:00Z")).toBe(true);
  });

  it("täcker kvällen före första dagen, som natten tillhör", () => {
    // 19:00 svensk tid den 16:e är 17:00Z.
    expect(inom("2026-08-16T17:00:00Z")).toBe(true);
  });

  it("täcker svansen av natten efter sista dagen", () => {
    // 05:00 svensk tid den 29:e är 03:00Z.
    expect(inom("2026-08-29T03:00:00Z")).toBe(true);
  });

  /* Marginalen ska vara en dag, inte obegränsad — annars hämtas pass
     ingen bett om, och 31-dagarsgränsen närmar sig i onödan. */
  it("vidgar inte fönstret mer än ett dygn i vardera riktningen", () => {
    expect(inom("2026-08-15T12:00:00Z")).toBe(false);
    expect(inom("2026-08-30T12:00:00Z")).toBe(false);
  });
});
