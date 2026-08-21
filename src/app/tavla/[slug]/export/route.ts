import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/server/auth";
import { getBoardWeek } from "@/server/board-week";
import { getVacationYear } from "@/server/vacation-year";
import { ABSENCE_LABEL, type AbsenceType } from "@/lib/absence";
import { SHIFT_LABEL_PLAIN } from "@/lib/shift-labels";
import { dateRangeLabel, isoWeek, shortDayLabel, toIso } from "@/lib/week";

export const dynamic = "force-dynamic";

const HEADER_FILL = "FFF3F4F6";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  });
}

/** Breddar kolumnerna efter innehållet, med tak så en lång notering inte tar över. */
function autoFit(sheet: ExcelJS.Worksheet, min = 8, max = 28) {
  sheet.columns.forEach((col) => {
    let width = min;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      width = Math.max(width, String(cell.value ?? "").length + 2);
    });
    col.width = Math.min(max, width);
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  // Rutten kan inte omdirigera till inloggningen som en sida gör, så den
  // svarar 401 i stället.
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const { slug } = await params;
  const url = new URL(request.url);
  const view = url.searchParams.get("vy") ?? "resource";
  const today = isoWeek(toIso(new Date()));
  const year = Number(url.searchParams.get("ar")) || today.year;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Schema";
  workbook.created = new Date();
  let filename: string;

  if (view === "semester") {
    const data = await getVacationYear(slug, year);
    if (!data) return NextResponse.json({ error: "Tavlan finns inte" }, { status: 404 });

    const sheet = workbook.addWorksheet(`Semester ${year}`);
    styleHeader(sheet.addRow(["Person", "Stationsort", ...data.weeks.map((w) => `v.${w}`)]));

    for (const row of data.rows) {
      const cells = data.weeks.map((w) => {
        const hit = row.absences.find((a) => a.weeks.includes(w));
        if (!hit) return "";
        const label = ABSENCE_LABEL[hit.type as AbsenceType];
        return hit.status === "requested" ? `${label}?` : label;
      });
      sheet.addRow([row.name, row.stationPlace ?? "", ...cells]);
    }

    const tail = sheet.addRow([
      "Bemanning kvar",
      "",
      ...data.weeks.map((w) => data.availablePerWeek[w] ?? 0),
    ]);
    tail.font = { bold: true };

    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
    autoFit(sheet, 6, 18);
    filename = `semester-${slug}-${year}.xlsx`;
  } else {
    const week = Number(url.searchParams.get("vecka")) || today.week;
    const data = await getBoardWeek(slug, year, week);
    if (!data) return NextResponse.json({ error: "Tavlan finns inte" }, { status: 404 });

    const sheet = workbook.addWorksheet(`Vecka ${week}`);
    sheet.addRow([data.board.name]).font = { bold: true, size: 14 };
    sheet.addRow([`Vecka ${week} · ${dateRangeLabel(data.dates)}`]).font = { italic: true };
    sheet.addRow([]);

    if (view === "person") {
      styleHeader(sheet.addRow(["Person", ...data.dates.map(shortDayLabel)]));
      for (const p of data.personRows) {
        sheet.addRow([
          p.name,
          ...p.days.map((d) => {
            if (d.absence) return ABSENCE_LABEL[d.absence.type as AbsenceType];
            if (d.entries.length === 0) return d.worksButUnplaced ? "ej utlagd" : "";
            return d.entries
              .map((e) => (data.shifts.length > 1 ? `${SHIFT_LABEL_PLAIN[e.shift]} ` : "") + e.rowLabel)
              .join(", ");
          }),
        ]);
      }
    } else {
      const showShift = data.shifts.length > 1;
      styleHeader(
        sheet.addRow([
          "Bil",
          "Linje",
          ...(showShift ? ["Skift"] : []),
          ...data.dates.map(shortDayLabel),
        ]),
      );

      let lastGroup: string | null | undefined;
      for (const row of data.rows) {
        if (row.groupLabel && row.groupLabel !== lastGroup) {
          const g = sheet.addRow([row.groupLabel]);
          g.font = { bold: true };
        }
        lastGroup = row.groupLabel;

        for (const shift of data.shifts) {
          const cells = data.dates.map((date) => {
            if (row.inactiveDates.includes(date)) return "–";
            return (row.cells[`${date}|${shift}`] ?? [])
              .map((c) => [c.employeeName ?? "", c.note].filter(Boolean).join(" "))
              .join(", ");
          });
          sheet.addRow([
            shift === data.shifts[0] ? row.label : "",
            shift === data.shifts[0] ? (row.sublabel ?? "") : "",
            ...(showShift ? [SHIFT_LABEL_PLAIN[shift]] : []),
            ...cells,
          ]);
        }
      }
    }

    sheet.views = [{ state: "frozen", ySplit: 4 }];
    autoFit(sheet);
    filename = `${slug}-v${week}-${year}.xlsx`;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
