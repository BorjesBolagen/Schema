"use client";

import { useState, useTransition } from "react";
import type { CellAssignment } from "@/server/board-week";
import { removeAssignment, setAssignmentNote } from "@/app/actions";
import { conflictTitle } from "./ConflictBadge";

/** Notering och borttagning för ett enskilt pass. */
export function AssignmentEditor({
  cell,
  boardSlug,
  onClose,
}: {
  cell: CellAssignment;
  boardSlug: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState(cell.note ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-(--color-line) bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-medium">{cell.employeeName ?? "Pass"}</h2>
        <p className="mt-1 text-xs text-(--color-muted)">
          {cell.source === "generated" ? "Utlagt av bas-schemat" : "Ändrat för hand"}
        </p>

        {cell.conflicts.length > 0 && (
          <ul className="mt-3 space-y-1 rounded bg-red-50 px-3 py-2 text-xs text-(--color-danger)">
            {cell.conflicts.map((c, i) => (
              <li key={i}>{conflictTitle(c)}</li>
            ))}
          </ul>
        )}

        <label className="mt-4 block text-xs text-(--color-muted)">
          Notering
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          />
        </label>

        <div className="mt-5 flex justify-between">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await removeAssignment(cell.id, boardSlug);
                onClose();
              })
            }
            className="rounded px-3 py-1.5 text-sm text-(--color-danger) hover:bg-red-50"
          >
            Ta bort passet
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm">
              Avbryt
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setAssignmentNote(cell.id, note, boardSlug);
                  onClose();
                })
              }
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
