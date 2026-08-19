"use client";

import { useState } from "react";
import type { BoardWeek } from "@/server/board-week";
import { shortDayLabel } from "@/lib/week";
import { ConflictMark } from "./ConflictBadge";
import { CellEditor, type EditorTarget } from "./CellEditor";

interface Props {
  data: BoardWeek;
  employees: Array<{ id: string; name: string }>;
  vehicles: Array<{ id: string; name: string }>;
}

const ABSENCE_ICON: Record<string, string> = {
  semester: "🏖",
  sjuk: "🤒",
  vab: "🧒",
  tjanstledig: "📄",
  foraldraledig: "🍼",
  kompledig: "⏱",
  ovrig: "•",
};

/**
 * Rutnätet med bilar/linjer som rader.
 *
 * Cellen visar förare överst och bilnummer under, enligt tavlans
 * cellFields. Konflikter markeras direkt i cellen med förklaring i
 * title, så planeraren ser orsaken utan att lämna vyn.
 */
export function WeekGrid({ data, employees, vehicles }: Props) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const showVehicle = data.board.cellFields.includes("vehicle");
  const showNote = data.board.cellFields.includes("note");

  const unavailableOn = (date: string) => {
    const free = new Set((data.availableByDate[date] ?? []).map((e) => e.id));
    return employees.map((e) => ({
      ...e,
      unavailable: free.has(e.id) ? undefined : "upptagen",
    }));
  };

  let lastGroup: string | null | undefined;

  return (
    <>
      <div className="grid-scroll rounded border border-(--color-line) bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="sticky left-0 z-10 border-b border-(--color-line) bg-gray-50 px-3 py-2 text-left font-medium">
                Rad
              </th>
              <th className="border-b border-(--color-line) px-3 py-2 text-left font-medium">Linje</th>
              {data.dates.map((d) => (
                <th
                  key={d}
                  className="min-w-28 border-b border-l border-(--color-line) px-3 py-2 text-left font-medium"
                >
                  {shortDayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const groupHeader = row.groupLabel !== lastGroup ? row.groupLabel : null;
              lastGroup = row.groupLabel;
              return (
                <>
                  {groupHeader && (
                    <tr key={`g-${row.id}`}>
                      <td
                        colSpan={2 + data.dates.length}
                        className="border-b border-(--color-line) bg-gray-100 px-3 py-1 text-xs font-semibold tracking-wide uppercase"
                      >
                        {groupHeader}
                      </td>
                    </tr>
                  )}
                  <tr key={row.id} className="align-top">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-(--color-line) bg-white px-3 py-2 text-left font-medium whitespace-nowrap"
                      style={row.color ? { borderLeft: `3px solid ${row.color}` } : undefined}
                    >
                      {row.label}
                    </th>
                    <td className="border-b border-(--color-line) px-3 py-2 text-(--color-muted) whitespace-nowrap">
                      {row.sublabel}
                    </td>
                    {data.dates.map((date) => {
                      const cells = row.cells[date] ?? [];
                      const inactive = row.inactiveDates.includes(date);
                      const nextSlot = cells.length;
                      return (
                        <td
                          key={date}
                          className={`border-b border-l border-(--color-line) p-0 ${
                            inactive ? "bg-gray-50" : ""
                          }`}
                        >
                          {inactive ? (
                            <div className="px-3 py-2 text-xs text-(--color-muted)">–</div>
                          ) : (
                            <div className="group flex flex-col">
                              {cells.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() =>
                                    setTarget({
                                      boardRowId: row.id,
                                      rowLabel: `${row.label}${row.sublabel ? ` · ${row.sublabel}` : ""}`,
                                      date,
                                      slot: c.slot,
                                      employeeId: c.employeeId,
                                      vehicleId: c.vehicleId,
                                      note: c.note,
                                    })
                                  }
                                  className="w-full px-3 py-1.5 text-left hover:bg-blue-50"
                                >
                                  <span className="flex items-center">
                                    <span
                                      className={
                                        c.employeeName ? "" : "text-(--color-muted) italic"
                                      }
                                    >
                                      {c.employeeName ?? c.note ?? "—"}
                                    </span>
                                    <ConflictMark conflicts={c.conflicts} />
                                  </span>
                                  {showVehicle && (c.vehicleName ?? row.defaultVehicleName) && (
                                    <span className="block text-xs text-(--color-muted)">
                                      {c.vehicleName ?? row.defaultVehicleName}
                                    </span>
                                  )}
                                  {showNote && c.employeeName && c.note && (
                                    <span className="block text-xs text-(--color-warn)">{c.note}</span>
                                  )}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  setTarget({
                                    boardRowId: row.id,
                                    rowLabel: `${row.label}${row.sublabel ? ` · ${row.sublabel}` : ""}`,
                                    date,
                                    slot: nextSlot,
                                    employeeId: null,
                                    vehicleId: row.defaultVehicleId,
                                    note: null,
                                  })
                                }
                                className={`px-3 py-1.5 text-left text-xs text-(--color-muted) hover:bg-blue-50 ${
                                  cells.length > 0 ? "opacity-0 group-hover:opacity-100 no-print" : ""
                                }`}
                              >
                                {cells.length === 0 ? "▢ tom" : "+ lägg till"}
                              </button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.absences.length > 0 && (
        <section className="mt-6 rounded border border-(--color-line) bg-white p-4">
          <h2 className="text-xs font-semibold tracking-wide uppercase">Frånvaro</h2>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {data.absences.map((a, i) => (
              <li key={`${a.employeeId}-${i}`}>
                <span className="mr-1">{ABSENCE_ICON[a.type] ?? "•"}</span>
                {a.name}
                <span className="ml-1 text-xs text-(--color-muted)">
                  {a.fromDate === a.toDate ? a.fromDate : `${a.fromDate} – ${a.toDate}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {target && (
        <CellEditor
          target={target}
          boardSlug={data.board.slug}
          employees={unavailableOn(target.date)}
          vehicles={vehicles}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
