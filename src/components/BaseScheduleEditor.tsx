"use client";

import { useState, useTransition } from "react";
import type { BoardWeek } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import { addBaseScheduleEntry, removeBaseScheduleEntry } from "@/app/actions";
import { SHIFT_ICON, SHIFT_LABEL } from "./shift";

/**
 * Bas-schemat: den stående kopplingen person ↔ bil.
 *
 * Här står inga dagar, och det är avsiktligt. Flera personer får
 * kopplas till samma rad — vem som faktiskt står där en viss dag avgörs
 * av deras arbetsdagar. Det är så BT13/14 kan bemannas av en person
 * fyra dagar och av en annan den femte utan att någon skriver in det.
 */
export function BaseScheduleEditor({
  data,
  onClose,
}: {
  data: BoardWeek;
  onClose: () => void;
}) {
  const [rowId, setRowId] = useState(data.rows[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState(data.crew[0]?.employeeId ?? "");
  const [shift, setShift] = useState<Shift>(data.shifts[0] ?? "day");
  const [pending, startTransition] = useTransition();

  const nameOf = (id: string) =>
    data.crew.find((c) => c.employeeId === id)?.name ??
    data.personRows.find((p) => p.employeeId === id)?.name ??
    "Okänd";
  const rowOf = (id: string) => data.rows.find((r) => r.id === id);

  const canAdd =
    rowId &&
    employeeId &&
    !data.baseSchedule.some(
      (b) => b.boardRowId === rowId && b.employeeId === employeeId && b.shift === shift,
    );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <div className="w-full max-w-2xl rounded-lg border border-(--color-line) bg-white shadow-xl">
        <div className="flex items-baseline justify-between border-b border-(--color-line) px-5 py-3">
          <h2 className="font-medium">Bas-schema · {data.board.name}</h2>
          <button type="button" onClick={onClose} className="text-sm text-(--color-accent)">
            Klar
          </button>
        </div>

        <p className="border-b border-(--color-line) bg-gray-50 px-5 py-2 text-xs text-(--color-muted)">
          Kopplar person till bil. Vilka dagar personen kör avgörs av personens arbetsdagar —
          koppla gärna flera personer till samma rad.
        </p>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-(--color-muted)">
              <th className="px-5 py-2 font-medium">Rad</th>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Skift</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.baseSchedule.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-sm text-(--color-muted)">
                  Inget bas-schema ännu. Koppla en person till en bil nedan.
                </td>
              </tr>
            )}
            {data.baseSchedule
              .slice()
              .sort(
                (a, b) =>
                  (rowOf(a.boardRowId)?.label ?? "").localeCompare(
                    rowOf(b.boardRowId)?.label ?? "",
                    "sv",
                  ) || nameOf(a.employeeId).localeCompare(nameOf(b.employeeId), "sv"),
              )
              .map((entry) => (
                <tr key={entry.id} className="border-t border-(--color-line)">
                  <td className="px-5 py-1.5 font-medium">{rowOf(entry.boardRowId)?.label ?? "—"}</td>
                  <td className="px-3 py-1.5">{nameOf(entry.employeeId)}</td>
                  <td className="px-3 py-1.5">
                    {SHIFT_ICON[entry.shift]} {SHIFT_LABEL[entry.shift]}
                  </td>
                  <td className="px-5 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(() => removeBaseScheduleEntry(entry.id, data.board.slug))
                      }
                      className="text-xs text-(--color-danger) hover:underline"
                    >
                      Ta bort
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-end gap-2 border-t border-(--color-line) px-5 py-4">
          <label className="text-xs text-(--color-muted)">
            Rad
            <select
              value={rowId}
              onChange={(e) => setRowId(e.target.value)}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            >
              {data.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                  {r.sublabel ? ` · ${r.sublabel}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-(--color-muted)">
            Person
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            >
              {data.crew.map((c) => (
                <option key={c.employeeId} value={c.employeeId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-(--color-muted)">
            Skift
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value as Shift)}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            >
              {(["day", "night"] as Shift[]).map((s) => (
                <option key={s} value={s}>
                  {SHIFT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={!canAdd || pending}
            onClick={() =>
              startTransition(() =>
                addBaseScheduleEntry({
                  boardId: data.board.id,
                  boardRowId: rowId,
                  employeeId,
                  shift,
                  validFrom: null,
                  boardSlug: data.board.slug,
                }),
              )
            }
            className="rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Koppla
          </button>

          {data.crew.length === 0 && (
            <p className="w-full text-xs text-(--color-warn)">
              Ingen bemanning vald ännu — välj personal först.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
