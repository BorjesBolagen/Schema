import { describe, expect, it } from "vitest";
import { buildMovePayload, shiftDays, ShiftMoveError } from "./shift-move";
import type { TranspaShift } from "./shifts";

/**
 * Kroppen skrivs till Börjes produktionstenant. Den provas därför på
 * det som faktiskt kan gå fel: att ett fält tappas bort, och att ett
 * pass över midnatt slutar ligga över midnatt.
 */

/** Ett verkligt nattpass: 16:00–03:00 svensk tid, med rast. */
const natten: TranspaShift = {
  id: "s1",
  employeeId: "e1",
  startDateTime: "2026-08-17T14:00:00.000Z", // 16:00 lokalt
  partsOfDay: [
    { endDateTime: "2026-08-17T20:00:00.000Z", vehicleId: "v1" },
    { endDateTime: "2026-08-18T01:00:00.000Z", vehicleId: "v1" },
  ],
  breaks: [{ start: "2026-08-17T18:00:00.000Z" }] as never,
  adjustedWorkTimeInMinutes: 600,
  isExtraShift: false,
  name: "16.00-03.00, Vmo-Sto ner",
};

describe("shiftDays", () => {
  it("räknar hela dygn framåt och bakåt", () => {
    expect(shiftDays({ from: "2026-08-19", to: "2026-08-20" })).toBe(1);
    expect(shiftDays({ from: "2026-08-20", to: "2026-08-19" })).toBe(-1);
    expect(shiftDays({ from: "2026-08-17", to: "2026-08-24" })).toBe(7);
  });

  it("klarar månadsskifte", () => {
    expect(shiftDays({ from: "2026-08-31", to: "2026-09-01" })).toBe(1);
  });
});

describe("buildMovePayload", () => {
  it("skjuter starten ett dygn", () => {
    const body = buildMovePayload(natten, 1);
    expect(body.startDateTime).toBe("2026-08-18T14:00:00.000Z");
  });

  /* Det som lätt går sönder: passet slutar dagen efter det börjar, och
     den relationen måste överleva flytten. */
  it("håller ihop passet över midnatt", () => {
    const delar = buildMovePayload(natten, 1).partsOfDay as Array<{ endDateTime: string }>;
    expect(delar.map((d) => d.endDateTime)).toEqual([
      "2026-08-18T20:00:00.000Z",
      "2026-08-19T01:00:00.000Z",
    ]);
  });

  it("ändrar inte klockslag eller längd", () => {
    const body = buildMovePayload(natten, 3);
    const start = new Date(body.startDateTime as string);
    expect(start.getUTCHours()).toBe(14);
    expect(body.adjustedWorkTimeInMinutes).toBe(600);
  });

  /* PUT ersätter passet, så ett utelämnat fält raderas. */
  it("skickar tillbaka allt passet bar", () => {
    const body = buildMovePayload(natten, 1);
    expect(body.id).toBe("s1");
    expect(body.employeeId).toBe("e1");
    expect(body.name).toBe("16.00-03.00, Vmo-Sto ner");
    /* Rasten följer med dygnet, den står inte kvar. Testet krävde
       tidigare att den var oförändrad — alltså att en flyttad natt
       hade sin rast kvar på den gamla dagen. */
    expect(body.breaks).toEqual([{ start: "2026-08-18T18:00:00.000Z" }]);
    expect(body.isExtraShift).toBe(false);
  });

  it("tar inte med fält passet inte hade", () => {
    const body = buildMovePayload({ ...natten, name: undefined, externalId: undefined }, 1);
    expect("name" in body).toBe(false);
    expect("externalId" in body).toBe(false);
  });

  it("flyttar bakåt lika bra som framåt", () => {
    expect(buildMovePayload(natten, -1).startDateTime).toBe("2026-08-16T14:00:00.000Z");
  });

  /* Hellre ett fel här än ett halvt pass i produktionstenanten. */
  it("vägrar flytta ett pass utan partsOfDay", () => {
    expect(() => buildMovePayload({ ...natten, partsOfDay: undefined }, 1)).toThrow(ShiftMoveError);
  });

  it("vägrar flytta ett pass utan starttid", () => {
    expect(() => buildMovePayload({ ...natten, startDateTime: undefined }, 1)).toThrow(
      ShiftMoveError,
    );
  });

  it("vägrar när en del saknar sluttid", () => {
    expect(() => buildMovePayload({ ...natten, partsOfDay: [{ vehicleId: "v1" }] }, 1)).toThrow(
      ShiftMoveError,
    );
  });
});

/**
 * Rasterna.
 *
 * Vismas schema säger `breaks*  [...]` — obligatoriskt, men formen står
 * inte utskriven. De skickades tillbaka som de kom, vilket betydde att
 * en flytt lämnade rasten kvar på det gamla dygnet medan resten av
 * passet flyttade sig. Ett pass med en rast utanför sig självt är
 * antingen nekat eller, värre, sparat.
 */
describe("rasterna följer med", () => {
  const pass = (breaks: unknown[]) => ({
    id: "s1",
    employeeId: "e1",
    startDateTime: "2026-09-04T05:00:00.000Z",
    partsOfDay: [{ endDateTime: "2026-09-04T15:00:00.000Z" }],
    breaks,
    adjustedWorkTimeInMinutes: 540,
  });

  it("skjuter rastens tider lika mycket som passets", () => {
    const body = buildMovePayload(
      pass([{ startDateTime: "2026-09-04T10:00:00.000Z", endDateTime: "2026-09-04T10:30:00.000Z" }]),
      -2,
    );
    expect(body.breaks).toEqual([
      { startDateTime: "2026-09-02T10:00:00.000Z", endDateTime: "2026-09-02T10:30:00.000Z" },
    ]);
  });

  /* Fältnamnen gissas inte — vi vet inte vad en rast heter. Det som har
     formen av en tidpunkt flyttas, resten står orört. */
  it("rör inte längder, id:n eller fritext", () => {
    const body = buildMovePayload(
      pass([
        {
          id: "b1",
          minutes: 30,
          note: "Rast 2026-09-04",
          paid: false,
          startDateTime: "2026-09-04T10:00:00.000Z",
        },
      ]),
      1,
    );
    expect(body.breaks).toEqual([
      {
        id: "b1",
        minutes: 30,
        note: "Rast 2026-09-04",
        paid: false,
        startDateTime: "2026-09-05T10:00:00.000Z",
      },
    ]);
  });

  it("klarar en rast som ligger efter midnatt i ett nattpass", () => {
    const body = buildMovePayload(
      {
        id: "s1",
        startDateTime: "2026-09-04T17:00:00.000Z",
        partsOfDay: [{ endDateTime: "2026-09-05T02:00:00.000Z" }],
        breaks: [{ startDateTime: "2026-09-05T00:30:00.000Z" }],
        adjustedWorkTimeInMinutes: 480,
      },
      1,
    );
    /* Rasten ska fortfarande ligga dygnet efter starten. */
    expect(body.breaks).toEqual([{ startDateTime: "2026-09-06T00:30:00.000Z" }]);
    expect(body.startDateTime).toBe("2026-09-05T17:00:00.000Z");
  });

  it("skickar en tom lista när passet saknar raster", () => {
    expect(buildMovePayload(pass([]), 1).breaks).toEqual([]);
  });

  it("går ned i nästlade fält", () => {
    const body = buildMovePayload(
      pass([{ window: { from: "2026-09-04T10:00:00.000Z" } }]),
      1,
    );
    expect(body.breaks).toEqual([{ window: { from: "2026-09-05T10:00:00.000Z" } }]);
  });
});
