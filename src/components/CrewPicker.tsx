"use client";

import { useMemo, useState, useTransition } from "react";
import { setCrew } from "@/app/actions";

export interface PickerEmployee {
  id: string;
  name: string;
  employeeNumber: string | null;
  stationPlace: string | null;
}

/**
 * Personalväljaren.
 *
 * Listan är hela personalregistret från TransPA — flera hundra namn.
 * Stationsortsfiltret med *välj alla* är det som gör den hanterbar; utan
 * det är listan i praktiken oanvändbar.
 */
export function CrewPicker({
  boardId,
  boardSlug,
  employees,
  selected,
  onClose,
}: {
  boardId: string;
  boardSlug: string;
  employees: PickerEmployee[];
  selected: string[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [station, setStation] = useState<string>("");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const stations = useMemo(
    () =>
      [...new Set(employees.map((e) => e.stationPlace).filter((s): s is string => !!s))].sort(
        (a, b) => a.localeCompare(b, "sv"),
      ),
    [employees],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (!station || e.stationPlace === station) &&
        (!q || e.name.toLowerCase().includes(q) || (e.employeeNumber ?? "").includes(q)),
    );
  }, [employees, station, query]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allVisiblePicked = visible.length > 0 && visible.every((e) => picked.has(e.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-(--color-line) bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between border-b border-(--color-line) px-5 py-3">
          <h2 className="font-medium">Lägg till personal</h2>
          <span className="text-xs text-(--color-muted)">{picked.size} valda</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-3">
          <label className="text-xs text-(--color-muted)">
            Stationsort{" "}
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className="rounded border border-(--color-line) px-2 py-1 text-sm text-(--color-ink)"
            >
              <option value="">Alla</option>
              {stations.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök namn eller anst.nr…"
            className="flex-1 rounded border border-(--color-line) px-3 py-1.5 text-sm"
          />

          <button
            type="button"
            disabled={visible.length === 0}
            onClick={() =>
              setPicked((prev) => {
                const next = new Set(prev);
                for (const e of visible) allVisiblePicked ? next.delete(e.id) : next.add(e.id);
                return next;
              })
            }
            className="rounded border border-(--color-line) px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {allVisiblePicked ? "Avmarkera" : "Välj alla"}
            {station ? ` i ${station}` : ""}
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {visible.map((e) => (
            <li key={e.id}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-1.5 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                <span className="flex-1">{e.name}</span>
                <span className="w-28 text-xs text-(--color-muted)">{e.stationPlace ?? "—"}</span>
                <span className="w-24 text-right text-xs text-(--color-muted)">
                  {e.employeeNumber ? `anst.nr ${e.employeeNumber}` : ""}
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-5 py-6 text-sm text-(--color-muted)">Ingen träff</li>
          )}
        </ul>

        <div className="flex justify-end gap-2 border-t border-(--color-line) px-5 py-3">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm">
            Avbryt
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setCrew(boardId, [...picked], boardSlug);
                onClose();
              })
            }
            className="rounded bg-(--color-accent) px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Spara
          </button>
        </div>
      </div>
    </div>
  );
}
