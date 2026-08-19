import { describe, expect, it } from "vitest";
import { parseAbsenceText, parseScheduleSheet } from "./parse-schema";
import type { Grid } from "./xlsx";

const WEEK = ["2025-06-29", "2025-06-30", "2025-07-01", "2025-07-02", "2025-07-03", "2025-07-04"];

describe("parseAbsenceText", () => {
  it('tyder "<namn> hela veckan"', () => {
    expect(parseAbsenceText("Alex S hela veckan", WEEK)).toMatchObject({
      alias: "Alex S",
      fromDate: "2025-06-29",
      toDate: "2025-07-04",
    });
  });

  it("tyder namn med veckodag", () => {
    expect(parseAbsenceText("Albin L tis", WEEK)).toMatchObject({
      alias: "Albin L",
      fromDate: "2025-07-01",
      toDate: "2025-07-01",
    });
  });

  it("lämnar ensamma namn otydda — rutan innehåller även tillgänglig personal", () => {
    expect(parseAbsenceText("MARCUS W", WEEK)).toBeNull();
    expect(parseAbsenceText("Jimmy", WEEK)).toBeNull();
  });
});

/** Minimalt blad med samma form som "Schema NYBHLF". */
function fixture(): Grid {
  const g: Grid = [];
  const put = (r: number, c: number, v: string | Date) => {
    g[r] ??= [];
    g[r][c] = v;
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  put(1, 0, "Vecka 27");
  put(1, 1, "Linje");
  put(1, 8, "Veckoschema Fjärr Nybro");
  put(2, 0, "Datum");
  ["2025-06-30", "2025-07-01", "2025-07-02", "2025-07-03", "2025-07-04"].forEach((s, i) =>
    put(2, 2 + i, d(s)),
  );
  put(2, 8, "Datum");
  WEEK.forEach((s, i) => put(2, 9 + i, d(s)));
  put(3, 8, "Ort");

  // Vänsterblock
  put(3, 0, "BT08/09");
  put(3, 1, "Stockholm");
  ["Elle", "Elle", "Elle", "Elle", "Elle"].forEach((v, i) => put(3, 2 + i, v));
  put(4, 0, "HF13");
  put(4, 1, "Extrabil");
  put(4, 2, "###");
  put(4, 5, "Emma S");

  // Högerblock, med fortsättningsrad
  put(4, 8, "BT08/09 STHLM");
  put(4, 9, "RASMUS W");
  put(4, 10, "CK");
  put(5, 8, ".");
  put(5, 9, "CASPER R BT23-->");

  // Semesterruta
  put(6, 8, "Semester");
  put(6, 9, "Alex S hela veckan");
  put(6, 10, "Albin L tis");
  put(7, 9, "MARCUS W");

  put(9, 0, "Vecka 28");
  return g;
}

describe("parseScheduleSheet", () => {
  const blocks = parseScheduleSheet(fixture());

  it("hittar veckoblocken", () => {
    expect(blocks.map((b) => b.week)).toEqual([27, 28]);
  });

  it("läser vänsterblocket som måndag–fredag", () => {
    expect(blocks[0].day.dates).toEqual([
      "2025-06-30",
      "2025-07-01",
      "2025-07-02",
      "2025-07-03",
      "2025-07-04",
    ]);
    expect(blocks[0].day.rows[0]).toMatchObject({ label: "BT08/09", sublabel: "Stockholm", slot: 0 });
    expect(blocks[0].day.rows[0].cells).toHaveLength(5);
  });

  it("behåller noteringar som ### i stället för att tappa dem", () => {
    const hf13 = blocks[0].day.rows.find((r) => r.label === "HF13")!;
    expect(hf13.cells).toEqual([
      { date: "2025-06-30", text: "###" },
      { date: "2025-07-03", text: "Emma S" },
    ]);
  });

  it("läser högerblocket som söndag–fredag", () => {
    expect(blocks[0].far.dates[0]).toBe("2025-06-29");
    expect(blocks[0].far.rows[0].label).toBe("BT08/09 STHLM");
  });

  it("kopplar den prickade raden till raden ovanför som slot 1", () => {
    const cont = blocks[0].far.rows.find((r) => r.slot === 1)!;
    expect(cont.label).toBe("BT08/09 STHLM");
    expect(cont.cells).toEqual([{ date: "2025-06-29", text: "CASPER R BT23-->" }]);
  });

  it("tyder semesterrutan och lämnar resten till granskning", () => {
    expect(blocks[0].absences.map((a) => a.alias)).toEqual(["Alex S", "Albin L"]);
    expect(blocks[0].unparsedAbsenceText).toEqual(["MARCUS W"]);
  });
});
