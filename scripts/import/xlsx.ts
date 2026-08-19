import ExcelJS from "exceljs";

export type CellValue = string | number | Date | null;
/** Nollindexerat rutnät: grid[rad][kolumn]. */
export type Grid = CellValue[][];

/** Plockar ut ett rent värde ur ExcelJS blandade celltyper. */
function cellValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join("");
    }
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return null;
}

export async function readSheet(file: string, sheetName: string): Promise<Grid> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    throw new Error(
      `Bladet "${sheetName}" saknas i ${file}. Blad som finns: ${wb.worksheets.map((w) => w.name).join(", ")}`,
    );
  }
  const grid: Grid = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const out: CellValue[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      out[colNumber - 1] = cellValue(cell.value);
    });
    grid[rowNumber - 1] = out;
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return grid;
}

/** Text i en cell, trimmad. Tom sträng när cellen är tom. */
export function text(grid: Grid, row: number, col: number): string {
  const v = grid[row]?.[col];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** ISO-datum (YYYY-MM-DD) för en cell som innehåller ett datum. */
export function isoDate(grid: Grid, row: number, col: number): string | null {
  const v = grid[row]?.[col];
  if (v instanceof Date) {
    // Excel-datum saknar tidszon; läs av UTC-fälten så dagen inte glider.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** True när hela raden är tom inom kolumnintervallet. */
export function rowIsEmpty(grid: Grid, row: number, fromCol: number, toCol: number): boolean {
  for (let c = fromCol; c <= toCol; c++) if (text(grid, row, c) !== "") return false;
  return true;
}
