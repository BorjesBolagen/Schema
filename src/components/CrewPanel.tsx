"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CrewMember } from "@/server/board-week";
import { shortDayLabel } from "@/lib/week";
import { ABSENCE_ICON, SHIFT_ICON } from "./shift";
import { dragId } from "./dnd";

function CrewCard({ member, dates }: { member: CrewMember; dates: string[] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId.crew(member.employeeId),
  });

  const byDate = new Map(member.workDays.map((w) => [w.date, w.shift]));
  const unplaced = new Set(member.unplaced.map((w) => w.date));

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded border border-(--color-line) bg-white px-2 py-1.5 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{member.name}</span>
        {member.absence && (
          <span title={member.absence.type} className="text-xs">
            {ABSENCE_ICON[member.absence.type] ?? "•"}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex gap-1 text-[11px]">
        {dates.map((d) => {
          const shift = byDate.get(d);
          return (
            <span
              key={d}
              title={shortDayLabel(d)}
              className={
                !shift
                  ? "text-gray-300"
                  : unplaced.has(d)
                    ? "font-semibold text-(--color-warn)"
                    : "text-(--color-muted)"
              }
            >
              {shift ? SHIFT_ICON[shift] : "·"}
            </span>
          );
        })}
      </div>
    </li>
  );
}

/**
 * Sidopanelen — dragkällan, och veckans kvitto.
 *
 * "Ej utlagda" listar dem som jobbar men ännu inte står på någon bil.
 * När listan är tom är veckan bemannad, vilket gör panelen till en
 * kontroll och inte bara en lista att dra ur.
 */
export function CrewPanel({
  crew,
  dates,
  onOpenPicker,
}: {
  crew: CrewMember[];
  dates: string[];
  onOpenPicker: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dragId.crewPanel });
  const unplaced = crew.filter((c) => c.unplaced.length > 0);
  const rest = crew.filter((c) => c.unplaced.length === 0);

  return (
    <aside
      ref={setNodeRef}
      className={`w-64 shrink-0 rounded border p-3 no-print ${
        isOver ? "border-(--color-danger) bg-red-50" : "border-(--color-line) bg-gray-50"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-wide uppercase">Bemanning</h2>
        <button
          type="button"
          onClick={onOpenPicker}
          className="text-xs text-(--color-accent) hover:underline"
        >
          + lägg till
        </button>
      </div>

      {crew.length === 0 && (
        <p className="mt-3 text-xs text-(--color-muted)">
          Ingen personal vald ännu. Välj ur personallistan för att komma igång.
        </p>
      )}

      {unplaced.length > 0 && (
        <>
          <h3 className="mt-4 text-[11px] font-semibold tracking-wide text-(--color-warn) uppercase">
            Ej utlagda ({unplaced.length})
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {unplaced.map((m) => (
              <CrewCard key={m.employeeId} member={m} dates={dates} />
            ))}
          </ul>
        </>
      )}

      {rest.length > 0 && (
        <>
          <h3 className="mt-4 text-[11px] font-semibold tracking-wide text-(--color-muted) uppercase">
            Utlagda
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {rest.map((m) => (
              <CrewCard key={m.employeeId} member={m} dates={dates} />
            ))}
          </ul>
        </>
      )}

      {isOver && (
        <p className="mt-3 rounded bg-red-100 px-2 py-1 text-xs text-(--color-danger)">
          Släpp här för att ta bort passet
        </p>
      )}
    </aside>
  );
}
