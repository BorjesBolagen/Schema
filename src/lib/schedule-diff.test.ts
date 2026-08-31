import { describe, expect, it } from "vitest";
import { detectMoves } from "./schedule-diff";

/**
 * Det som skickas till TransPA byggs ur den här jämförelsen. Paras fel
 * pass ihop skrivs fel pass om — i en produktionstenant.
 */
const dag = (employeeId: string, date: string, shift: "day" | "night" = "day") => ({
  employeeId,
  date,
  shift,
});
const pass = (
  employeeId: string,
  date: string,
  transpaId: string,
  shift: "day" | "night" = "day",
) => ({ employeeId, date, shift, transpaId });

describe("detectMoves", () => {
  it("hittar ingen ändring när tavlan och TransPA säger samma sak", () => {
    const d = detectMoves({
      placed: [dag("e1", "2026-08-19")],
      planned: [pass("e1", "2026-08-19", "s1")],
    });
    expect(d).toEqual({ moves: [], added: [], removed: [] });
  });

  /* Johans fall: ett pass draget från onsdag till torsdag. */
  it("läser en flyttad dag som en flytt", () => {
    const d = detectMoves({
      placed: [dag("e1", "2026-08-20")],
      planned: [pass("e1", "2026-08-19", "s1")],
    });
    expect(d.moves).toEqual([
      { employeeId: "e1", transpaId: "s1", shift: "day", from: "2026-08-19", to: "2026-08-20" },
    ]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  /* Parningen måste vara i datumordning: det är passets id som skrivs,
     så fel parning skriver om fel pass. */
  it("parar tidigaste med tidigaste när två pass flyttats", () => {
    const d = detectMoves({
      placed: [dag("e1", "2026-08-21"), dag("e1", "2026-08-18")],
      planned: [pass("e1", "2026-08-17", "s1"), pass("e1", "2026-08-20", "s2")],
    });
    expect(d.moves).toEqual([
      { employeeId: "e1", transpaId: "s1", shift: "day", from: "2026-08-17", to: "2026-08-18" },
      { employeeId: "e1", transpaId: "s2", shift: "day", from: "2026-08-20", to: "2026-08-21" },
    ]);
  });

  it("håller isär dag och natt", () => {
    const d = detectMoves({
      placed: [dag("e1", "2026-08-20", "night")],
      planned: [pass("e1", "2026-08-19", "s1", "night"), pass("e1", "2026-08-19", "s2", "day")],
    });
    expect(d.moves).toEqual([
      { employeeId: "e1", transpaId: "s1", shift: "night", from: "2026-08-19", to: "2026-08-20" },
    ]);
    expect(d.removed).toEqual([pass("e1", "2026-08-19", "s2", "day")]);
  });

  it("håller isär personer", () => {
    const d = detectMoves({
      placed: [dag("e2", "2026-08-20")],
      planned: [pass("e1", "2026-08-19", "s1")],
    });
    expect(d.moves).toEqual([]);
    expect(d.added).toEqual([dag("e2", "2026-08-20")]);
    expect(d.removed).toEqual([pass("e1", "2026-08-19", "s1")]);
  });

  /* Ett pass som bara tillkommit är inte en flytt. Att skapa ett pass är
     något annat än att flytta ett, och att gissa fel vore att skriva om
     ett pass som inte skulle röras. */
  it("kallar en ensam ny dag för tillagd, inte flyttad", () => {
    const d = detectMoves({
      placed: [dag("e1", "2026-08-19"), dag("e1", "2026-08-20")],
      planned: [pass("e1", "2026-08-19", "s1")],
    });
    expect(d.moves).toEqual([]);
    expect(d.added).toEqual([dag("e1", "2026-08-20")]);
  });

  it("kallar ett pass ingen står på för borttaget", () => {
    const d = detectMoves({ placed: [], planned: [pass("e1", "2026-08-19", "s1")] });
    expect(d.moves).toEqual([]);
    expect(d.removed).toEqual([pass("e1", "2026-08-19", "s1")]);
  });

  it("räknar två pass samma dag och skift som en dag", () => {
    // Samma person kan stå på två rader samma dag; det är en arbetsdag.
    const d = detectMoves({
      placed: [dag("e1", "2026-08-19"), dag("e1", "2026-08-19")],
      planned: [pass("e1", "2026-08-19", "s1")],
    });
    expect(d).toEqual({ moves: [], added: [], removed: [] });
  });
});
