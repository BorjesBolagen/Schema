"use client";

import { Fragment } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { BoardWeek, CellAssignment, WeekRow } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import { shortDayLabel } from "@/lib/week";
import { ConflictMark } from "./ConflictBadge";
import { SHIFT_ICON, SHIFT_LABEL } from "./shift";
import { dragId } from "./dnd";

export interface DropCheck {
  (target: { boardRowId: string; date: string; shift: Shift }): string | null;
}

function Pass({
  cell,
  onOpen,
}: {
  cell: CellAssignment;
  onOpen: (cell: CellAssignment) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId.assignment(cell.id),
  });

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(cell)}
      className={`flex cursor-grab items-center gap-1 rounded px-1 hover:bg-blue-50 ${
        isDragging ? "opacity-40" : ""
      } ${cell.source === "generated" ? "" : "font-medium"}`}
      title={cell.source === "generated" ? "Från bas-schemat" : "Ändrad för hand"}
    >
      <span className={cell.employeeName ? "" : "text-(--color-muted) italic"}>
        {cell.employeeName ?? cell.note ?? "—"}
      </span>
      <ConflictMark conflicts={cell.conflicts} />
      {cell.employeeName && cell.note && (
        <span className="text-xs text-(--color-warn)">{cell.note}</span>
      )}
    </span>
  );
}

function ShiftCell({
  row,
  date,
  shift,
  showShiftIcon,
  showVehicle,
  onOpen,
  dropCheck,
}: {
  row: WeekRow;
  date: string;
  shift: Shift;
  showShiftIcon: boolean;
  showVehicle: boolean;
  onOpen: (cell: CellAssignment) => void;
  dropCheck: DropCheck;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: dragId.cell(row.id, date, shift),
  });
  const cells = row.cells[`${date}|${shift}`] ?? [];

  // Varför en släppning skulle bli fel — visas redan under dragningen.
  const problem = active ? dropCheck({ boardRowId: row.id, date, shift }) : null;
  const vehicle = cells[0]?.vehicleName ?? row.defaultVehicleName;

  return (
    <div
      ref={setNodeRef}
      data-cell={`${row.id}|${date}|${shift}`}
      data-shift={shift}
      className={`min-h-9 px-2 py-1 ${
        isOver ? (problem ? "bg-red-100 outline outline-(--color-danger)" : "bg-blue-100") : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2">
        {showShiftIcon && (
          <span className="text-xs text-(--color-muted)" title={SHIFT_LABEL[shift]}>
            {SHIFT_ICON[shift]}
          </span>
        )}
        {cells.length === 0 ? (
          <span className="text-xs text-(--color-muted)">▢</span>
        ) : (
          cells.map((c) => <Pass key={c.id} cell={c} onOpen={onOpen} />)
        )}
      </div>
      {showVehicle && vehicle && cells.length > 0 && (
        <div className="text-xs text-(--color-muted)">{vehicle}</div>
      )}
      {isOver && problem && (
        <div className="mt-0.5 text-[11px] font-medium text-(--color-danger)">{problem}</div>
      )}
    </div>
  );
}

/**
 * Rutnätet med bilar/linjer som rader.
 *
 * En cell har en rad per skift som tavlan visar. En bil som bara körs
 * dagtid visar bara dagraden och då utan skiftikon, eftersom ikonen
 * inte skiljer något åt när det bara finns ett skift.
 */
export function WeekGrid({
  data,
  onOpen,
  dropCheck,
}: {
  data: BoardWeek;
  onOpen: (cell: CellAssignment) => void;
  dropCheck: DropCheck;
}) {
  const showVehicle = data.board.cellFields.includes("vehicle");
  const showShiftIcon = data.shifts.length > 1;
  let lastGroup: string | null | undefined;

  return (
    <div className="grid-scroll rounded border border-(--color-line) bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-10 border-b border-(--color-line) bg-gray-50 px-3 py-2 text-left font-medium">
              Bil
            </th>
            <th className="border-b border-(--color-line) px-3 py-2 text-left font-medium">Linje</th>
            {data.dates.map((d) => (
              <th
                key={d}
                className="min-w-32 border-b border-l border-(--color-line) px-3 py-2 text-left font-medium"
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
              <Fragment key={row.id}>
                {groupHeader && (
                  <tr>
                    <td
                      colSpan={2 + data.dates.length}
                      className="border-b border-(--color-line) bg-gray-100 px-3 py-1 text-xs font-semibold tracking-wide uppercase"
                    >
                      {groupHeader}
                    </td>
                  </tr>
                )}
                <tr className="align-top">
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
                    const inactive = row.inactiveDates.includes(date);
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
                          data.shifts.map((shift) => (
                            <ShiftCell
                              key={shift}
                              row={row}
                              date={date}
                              shift={shift}
                              showShiftIcon={showShiftIcon}
                              showVehicle={showVehicle}
                              onOpen={onOpen}
                              dropCheck={dropCheck}
                            />
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
