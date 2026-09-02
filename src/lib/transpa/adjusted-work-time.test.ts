import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AdjustedWorkTimeError,
  buildAdjustedWorkTimePayload,
  CALCULATE_PATH,
  readAdjustedWorkTime,
} from "./adjusted-work-time";

/**
 * Checksumman är det som fattades.
 *
 * PUT /v1/shifts/{id} har checkSum som obligatorisk frågeparameter, och
 * utan den svarar TransPA 404 "Resource not found" — på ett pass som
 * hämtats utan problem sekunden innan. Samma mönster som listvägen, som
 * svarade 404 tills datumparametrarna kom med.
 */

describe("readAdjustedWorkTime", () => {
  it("plockar checksumman och minuterna ur svaret", () => {
    const ut = readAdjustedWorkTime({
      checkSum: "b1df383d-23f5-4aa3-118c-bbb551abfd9d",
      adjustedWorkTimeInMinutes: 540,
    });
    expect(ut.checkSum).toBe("b1df383d-23f5-4aa3-118c-bbb551abfd9d");
    expect(ut.adjustedWorkTimeInMinutes).toBe(540);
  });

  /* Vismas genererade klient är PascalCase, deras egna exempel
     camelCase. Vilket svaret bär syns först i ett riktigt svar. */
  it("bryr sig inte om skiftläge", () => {
    expect(readAdjustedWorkTime({ CheckSum: "abc" }).checkSum).toBe("abc");
  });

  it("går ett steg ned i ett kuvert", () => {
    const ut = readAdjustedWorkTime({
      result: { checkSum: "abc", adjustedWorkTimeInMinutes: 480 },
    });
    expect(ut.checkSum).toBe("abc");
    expect(ut.adjustedWorkTimeInMinutes).toBe(480);
  });

  /* Utan minuter går skrivningen ändå vidare — då står vårt eget värde
     kvar, vilket är sämre men inte fel. Utan checksumma finns ingen
     skrivning att göra. */
  it("klarar sig utan minuterna", () => {
    expect(readAdjustedWorkTime({ checkSum: "abc" }).adjustedWorkTimeInMinutes).toBeUndefined();
  });

  it("kastar när checksumman saknas", () => {
    expect(() => readAdjustedWorkTime({ minutes: 540 })).toThrow(AdjustedWorkTimeError);
  });

  /* Felet ska säga vad som *fanns*. Det är den upplysningen som gör
     nästa försök billigt när kvoten är liten. */
  it("räknar upp nycklarna som fanns i svaret", () => {
    try {
      readAdjustedWorkTime({ data: { workTime: 540 }, status: "ok" });
      throw new Error("skulle ha kastat");
    } catch (e) {
      expect((e as Error).message).toContain("data.workTime");
      expect((e as Error).message).toContain("status");
      expect((e as Error).message).toContain(CALCULATE_PATH);
    }
  });

  it("säger 'inga' när svaret var tomt", () => {
    expect(() => readAdjustedWorkTime(null)).toThrow(/inga/);
  });

  it("godtar inte en tom sträng som checksumma", () => {
    expect(() => readAdjustedWorkTime({ checkSum: "" })).toThrow(AdjustedWorkTimeError);
  });
});

/**
 * Fältnamnen läses ur specen, inte ur en lista jag skrivit av.
 *
 * En avskriven lista är sann den dag den skrivs och tyst fel därefter.
 * docs/transpa-openapi.yaml ligger i repot just för att den här sortens
 * kontroll ska gå att göra utan nät — miljön når inte api.mytranspa.com,
 * och varje anrop dit kostar ur en kvot som redan tagit slut en gång.
 */
function tillåtnaFält(schema: string, block: string): string[] {
  const yaml = readFileSync("docs/transpa-openapi.yaml", "utf8").split("\n");
  const start = yaml.findIndex((r) => r.trim() === `${schema}:`);
  if (start < 0) throw new Error(`hittade inte schemat ${schema}`);
  const indent = yaml[start].search(/\S/);

  /* Slutar vid nästa rad på samma eller lägre indrag — alltså nästa
     schema. */
  let slut = yaml.length;
  for (let i = start + 1; i < yaml.length; i++) {
    const rad = yaml[i];
    if (rad.trim() === "" || rad.trim().startsWith("#")) continue;
    if (rad.search(/\S/) <= indent) {
      slut = i;
      break;
    }
  }

  const kropp = yaml.slice(start, slut);
  const propsRad = kropp.findIndex((r) => r.trim() === `${block}:`);
  if (propsRad < 0) throw new Error(`hittade inte ${block} i ${schema}`);
  const propsIndent = kropp[propsRad].search(/\S/);

  const namn: string[] = [];
  for (let i = propsRad + 1; i < kropp.length; i++) {
    const rad = kropp[i];
    if (rad.trim() === "" || rad.trim().startsWith("#")) continue;
    const d = rad.search(/\S/);
    if (d <= propsIndent) break;
    const m = /^\s*([A-Za-z][A-Za-z0-9]*):/.exec(rad);
    if (d === propsIndent + 2 && m) namn.push(m[1]);
  }
  return namn;
}

describe("buildAdjustedWorkTimePayload", () => {
  const pass = {
    id: "s1",
    employeeId: "e1",
    name: "16.00-03.00, Vmo-Sto ner",
    description: "text",
    externalId: "abcdef",
    isExtraShift: false,
    adjustedWorkTimeInMinutes: 600,
    startDateTime: "2026-09-04T14:00:00.000Z",
    breaks: [
      { startDateTime: "2026-09-04T18:00:00.000Z", endDateTime: "2026-09-04T18:45:00.000Z" },
    ],
    partsOfDay: [
      {
        endDateTime: "2026-09-05T01:00:00.000Z",
        vehicleId: "v1",
        workTaskId: "w1",
        customCounters: { customCounterOne: 80000.3 },
        trailerVehicleId: "t1",
        costDistributionCode: "1010",
      },
    ],
  };

  /* Testet som betyder något: uträkningens schema har
     additionalProperties: false. Vi kom igenom med hela passet ändå —
     deras validering är tillåtande i dag — men det är odefinierat
     beteende, och den dagen de skärper den slutar varje flytt fungera. */
  it("skickar bara fält som adjustedWorkTime-schemat tillåter", () => {
    const tillåtna = tillåtnaFält("adjustedWorkTime", "properties");
    expect(tillåtna).toContain("startDateTime");
    expect(tillåtna).toContain("breaks");
    expect(tillåtna).toContain("partsOfDay");
    expect(tillåtna).not.toContain("adjustedWorkTimeInMinutes");

    for (const fält of Object.keys(buildAdjustedWorkTimePayload(pass))) {
      expect(tillåtna, `${fält} finns inte i schemat`).toContain(fält);
    }
  });

  it("tar med alla obligatoriska fält", () => {
    const body = buildAdjustedWorkTimePayload(pass);
    for (const krav of ["startDateTime", "breaks", "partsOfDay"]) {
      expect(body).toHaveProperty(krav);
    }
  });

  /* partsOfDay har ett eget, ännu snävare schema i uträkningen: bara
     endDateTime och workTaskId. Passets vehicleId och mätarställningar
     hör hemma i passet, inte här. */
  it("skalar av partsOfDay till det uträkningen frågar efter", () => {
    const del = (buildAdjustedWorkTimePayload(pass).partsOfDay as Array<Record<string, unknown>>)[0];
    expect(Object.keys(del).sort()).toEqual(["endDateTime", "workTaskId"]);
  });

  it("utelämnar workTaskId när passet saknar det", () => {
    const utan = { ...pass, partsOfDay: [{ endDateTime: "2026-09-05T01:00:00.000Z" }] };
    const del = (buildAdjustedWorkTimePayload(utan).partsOfDay as Array<object>)[0];
    expect(Object.keys(del)).toEqual(["endDateTime"]);
  });

  it("behåller rasternas tider men inget annat", () => {
    const medExtra = {
      ...pass,
      breaks: [
        { id: "b1", paid: false, startDateTime: "2026-09-04T18:00:00.000Z", endDateTime: "2026-09-04T18:45:00.000Z" },
      ],
    };
    expect(buildAdjustedWorkTimePayload(medExtra).breaks).toEqual([
      { startDateTime: "2026-09-04T18:00:00.000Z", endDateTime: "2026-09-04T18:45:00.000Z" },
    ]);
  });

  it("utelämnar employeeId när passet saknar person", () => {
    expect(buildAdjustedWorkTimePayload({ ...pass, employeeId: null })).not.toHaveProperty(
      "employeeId",
    );
  });

  /* Passets egen kropp ska däremot bära allt — shift-schemat tillåter
     de fälten, och PUT ersätter hela passet. */
  it("passets eget schema tillåter det flytten skickar dit", () => {
    const tillåtna = tillåtnaFält("shift", "properties");
    for (const fält of ["id", "employeeId", "name", "description", "externalId", "isExtraShift", "adjustedWorkTimeInMinutes"]) {
      expect(tillåtna).toContain(fält);
    }
  });
});
