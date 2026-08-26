"use client";

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { CrewMember } from "@/server/board-week";
import { ROLE_LABEL, type PickerEmployee } from "./CrewPicker";
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

/** Så många sökträffar som visas. Fler blir en lista att läsa, inte att välja ur. */
const MAX_HITS = 10;

/**
 * En sökträff, dragbar direkt.
 *
 * Skiljer sig från CrewCard genom att personen ännu inte hör till
 * tavlan — hen läggs till i bemanningen när hen släpps på en rad. Därför
 * visas stationsort och anställningsnummer i stället för veckans dagar:
 * det är det som skiljer två personer med samma förnamn åt.
 */
function SearchCard({ person }: { person: PickerEmployee }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId.crew(person.id),
  });

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded border border-dashed border-(--color-accent) bg-white px-2 py-1.5 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <span className="block text-sm font-medium">{person.name}</span>
      <span className="text-[11px] text-(--color-muted)">
        {person.stationPlace ?? "ingen ort"}
        {person.employeeNumber ? ` · ${person.employeeNumber}` : ""}
        {person.professionGroup && person.professionGroup !== "driver"
          ? ` · ${ROLE_LABEL[person.professionGroup] ?? person.professionGroup}`
          : ""}
      </span>
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
  allEmployees,
  onOpenPicker,
}: {
  crew: CrewMember[];
  dates: string[];
  allEmployees: PickerEmployee[];
  onOpenPicker: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dragId.crewPanel });
  const unplaced = crew.filter((c) => c.unplaced.length > 0);
  const rest = crew.filter((c) => c.unplaced.length === 0);
  const [query, setQuery] = useState("");

  /**
   * Söker i hela personalregistret, inte bara i bemanningen.
   *
   * Poängen är att slippa gå via personalväljaren för att lägga till en
   * person: sök, dra ut träffen på en rad, klart. De som redan är med
   * utelämnas — de står ju redan i listan nedanför.
   */
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const inCrew = new Set(crew.map((c) => c.employeeId));
    return allEmployees
      .filter(
        (e) =>
          !inCrew.has(e.id) &&
          (e.name.toLowerCase().includes(q) || (e.employeeNumber ?? "").includes(q)),
      )
      .slice(0, MAX_HITS);
  }, [allEmployees, crew, query]);

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

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Sök i all personal …"
        aria-label="Sök i all personal"
        className="mt-2 w-full rounded border border-(--color-line) bg-white px-2 py-1 text-sm"
      />

      {query.trim().length >= 2 && (
        <div className="mt-2">
          {hits.length === 0 ? (
            <p className="text-xs text-(--color-muted)">
              Ingen träff utanför bemanningen. Är personalen synkad från TransPA?
            </p>
          ) : (
            <>
              <p className="text-[11px] text-(--color-muted)">
                Dra en träff till en rad för att lägga ut hela veckan.
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {hits.map((p) => (
                  <SearchCard key={p.id} person={p} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

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
