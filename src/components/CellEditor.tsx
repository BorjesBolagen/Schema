"use client";

import { useState, useTransition } from "react";
import { setAssignment } from "@/app/actions";

export interface EditorTarget {
  boardRowId: string;
  rowLabel: string;
  date: string;
  slot: number;
  employeeId: string | null;
  vehicleId: string | null;
  note: string | null;
}

interface Props {
  target: EditorTarget;
  boardSlug: string;
  employees: Array<{ id: string; name: string; unavailable?: string }>;
  vehicles: Array<{ id: string; name: string }>;
  onClose: () => void;
}

/**
 * Redigerar en cell.
 *
 * Förare som redan är bokade eller frånvarande visas kvar i listan men
 * gråade och med orsak — planeraren ska kunna se dem och medvetet välja
 * ändå, inte undra vart de tog vägen.
 */
export function CellEditor({ target, boardSlug, employees, vehicles, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [note, setNote] = useState(target.note ?? "");
  const [vehicleId, setVehicleId] = useState(target.vehicleId ?? "");
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const matches = q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;

  const save = (employeeId: string | null) => {
    startTransition(async () => {
      await setAssignment({
        boardRowId: target.boardRowId,
        date: target.date,
        slot: target.slot,
        employeeId,
        vehicleId: vehicleId || null,
        note: note.trim() || null,
        boardSlug,
      });
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-(--color-line) bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">{target.rowLabel}</h2>
          <span className="text-xs text-(--color-muted)">{target.date}</span>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök förare…"
          className="mt-4 w-full rounded border border-(--color-line) px-3 py-2 text-sm"
        />

        <ul className="mt-2 max-h-56 overflow-y-auto rounded border border-(--color-line)">
          {matches.slice(0, 60).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => save(e.id)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                  e.unavailable ? "text-(--color-muted)" : ""
                } ${e.id === target.employeeId ? "bg-blue-50 font-medium" : ""}`}
              >
                <span>{e.name}</span>
                {e.unavailable && <span className="text-xs">{e.unavailable}</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-(--color-muted)">Ingen träff</li>
          )}
        </ul>

        <label className="mt-4 block text-xs text-(--color-muted)">
          Bil
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="mt-1 w-full rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          >
            <option value="">— ingen —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-xs text-(--color-muted)">
          Notering
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          />
        </label>

        <div className="mt-5 flex justify-between">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(null)}
            className="rounded px-3 py-1.5 text-sm text-(--color-danger) hover:bg-red-50"
          >
            Töm cellen
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm">
              Avbryt
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(target.employeeId)}
              className="rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Spara
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
