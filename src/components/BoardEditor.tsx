"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Shift } from "@/lib/work-days";
import {
  VEHICLE_KIND_HINT,
  VEHICLE_KIND_LABEL,
  VEHICLE_KINDS,
  type VehicleKind,
} from "@/lib/vehicle-kind";
import {
  addBoardGroup,
  addBoardRow,
  deleteBoardGroup,
  deleteBoardRow,
  endBoardRow,
  renameBoardGroup,
  reorderBoardRows,
  updateBoard,
  updateBoardRow,
} from "@/app/actions";
import { boardRemovalPreview, removeBoard } from "@/app/basedata-actions";
import type { BoardRemovalFacts } from "@/server/boards";
import { SHIFT_LABEL } from "./shift";
import { cyclePosition, MAX_CYCLE_WEEKS } from "@/lib/rotation";
import { isoWeek, toIso } from "@/lib/week";

export interface EditableRow {
  id: string;
  label: string;
  sublabel: string | null;
  groupId: string | null;
  color: string | null;
  defaultVehicleId: string | null;
  vehicleKind: VehicleKind;
  validTo: string | null;
}

export interface EditableBoard {
  id: string;
  slug: string;
  name: string;
  weekStartsOn: number;
  visibleWeekdays: number[];
  visibleShifts: string[];
  cellFields: string[];
}

interface Props {
  board: EditableBoard;
  rows: EditableRow[];
  groups: Array<{ id: string; label: string }>;
  vehicles: Array<{ id: string; name: string }>;
  onClose: () => void;
  /** Bara administratörer ser borttagningen. Servern kräver det ändå. */
  canDelete?: boolean;
}

const WEEKDAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "O" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "L" },
  { value: 0, label: "S" },
];

const CELL_FIELDS = [
  { value: "driver", label: "Förare" },
  { value: "vehicle", label: "Bilnummer" },
  { value: "note", label: "Notering" },
];

function RowItem({
  row,
  groups,
  vehicles,
  slug,
  onChanged,
}: {
  row: EditableRow;
  groups: Props["groups"];
  vehicles: Props["vehicles"];
  slug: string;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const [label, setLabel] = useState(row.label);
  const [sublabel, setSublabel] = useState(row.sublabel ?? "");
  const [, startTransition] = useTransition();

  const save = (patch: Parameters<typeof updateBoardRow>[0]) =>
    startTransition(async () => {
      await updateBoardRow(patch);
      onChanged();
    });

  return (
    <li
      ref={setNodeRef}
      data-row-id={row.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 border-b border-(--color-line) px-2 py-1.5 ${
        isDragging ? "bg-blue-50" : ""
      } ${row.validTo ? "opacity-60" : ""}`}
    >
      <span
        {...listeners}
        {...attributes}
        className="cursor-grab px-1 text-(--color-muted)"
        title="Dra för att ändra ordning"
      >
        ⠿
      </span>

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== row.label && save({ rowId: row.id, boardSlug: slug, label })}
        className="w-32 rounded border border-transparent px-1.5 py-1 text-sm font-medium hover:border-(--color-line) focus:border-(--color-accent)"
      />
      <input
        value={sublabel}
        placeholder="linje/ort"
        onChange={(e) => setSublabel(e.target.value)}
        onBlur={() =>
          sublabel !== (row.sublabel ?? "") &&
          save({ rowId: row.id, boardSlug: slug, sublabel: sublabel || null })
        }
        className="w-28 rounded border border-transparent px-1.5 py-1 text-sm hover:border-(--color-line) focus:border-(--color-accent)"
      />

      <select
        value={row.groupId ?? ""}
        onChange={(e) => save({ rowId: row.id, boardSlug: slug, groupId: e.target.value || null })}
        className="rounded border border-(--color-line) px-1.5 py-1 text-xs"
      >
        <option value="">— ingen grupp —</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>

      <select
        value={row.defaultVehicleId ?? ""}
        onChange={(e) =>
          save({ rowId: row.id, boardSlug: slug, defaultVehicleId: e.target.value || null })
        }
        className="rounded border border-(--color-line) px-1.5 py-1 text-xs"
        title="Bilen raden står för"
      >
        <option value="">— ingen bil —</option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>

      {/* Biltypen styr om riktningen upp/ner visas i cellen. Två
          personer kör en linjebil samma natt åt var sitt håll; en
          bytesbil vänder halvvägs och har ingen riktning att hålla
          isär. */}
      <select
        value={row.vehicleKind}
        onChange={(e) =>
          save({ rowId: row.id, boardSlug: slug, vehicleKind: e.target.value as VehicleKind })
        }
        className="rounded border border-(--color-line) px-1.5 py-1 text-xs"
        title={VEHICLE_KIND_HINT[row.vehicleKind]}
      >
        {VEHICLE_KINDS.map((k) => (
          <option key={k} value={k}>
            {VEHICLE_KIND_LABEL[k]}
          </option>
        ))}
      </select>

      <input
        type="color"
        value={row.color ?? "#ffffff"}
        onChange={(e) => save({ rowId: row.id, boardSlug: slug, color: e.target.value })}
        className="h-6 w-8 cursor-pointer rounded border border-(--color-line)"
        title="Radfärg"
      />

      <span className="ml-auto flex items-center gap-1">
        {row.validTo ? (
          <button
            type="button"
            onClick={() => save({ rowId: row.id, boardSlug: slug, validTo: null })}
            className="rounded px-2 py-1 text-xs text-(--color-accent) hover:bg-blue-50"
            title={`Avslutad ${row.validTo}`}
          >
            Återuppta
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                await endBoardRow(row.id, new Date().toISOString().slice(0, 10), slug);
                onChanged();
              })
            }
            className="rounded px-2 py-1 text-xs hover:bg-gray-100"
            title="Raden slutar visas framåt men historiken finns kvar"
          >
            Avsluta
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            confirm(`Ta bort ${row.label}? Passen på raden försvinner också.`) &&
            startTransition(async () => {
              await deleteBoardRow(row.id, slug);
              onChanged();
            })
          }
          className="rounded px-2 py-1 text-xs text-(--color-danger) hover:bg-red-50"
        >
          Ta bort
        </button>
      </span>
    </li>
  );
}

/**
 * Tavelredigeraren.
 *
 * Här styr trafikansvarig hela utseendet: radernas namn, ordning,
 * gruppering och färg, vilken bil varje rad står för, samt vilka
 * veckodagar och skift tavlan visar. Inget av det ska kräva en
 * utvecklare — det är hela poängen med att tavlan är data och inte kod.
 */
export function BoardEditor({ board, rows, groups, vehicles, onClose, canDelete = false }: Props) {
  const [order, setOrder] = useState(rows.map((r) => r.id));
  const [newRow, setNewRow] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  /** null = borttagning inte påbörjad. Annars: vad den skulle kosta. */
  const [removal, setRemoval] = useState<BoardRemovalFacts | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = order.map((id) => byId.get(id)).filter((r): r is EditableRow => !!r);
  const refresh = () => setOrder(rows.map((r) => r.id));

  const set = (patch: Partial<EditableBoard>) =>
    startTransition(async () => {
      await updateBoard({ boardId: board.id, boardSlug: board.slug, ...patch });
    });

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    startTransition(() => reorderBoardRows(next, board.slug));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <div className="w-full max-w-4xl rounded-lg border border-(--color-line) bg-white shadow-xl">
        <div className="flex items-baseline justify-between border-b border-(--color-line) px-5 py-3">
          <h2 className="font-medium">Redigera tavla</h2>
          <button type="button" onClick={onClose} className="text-sm text-(--color-accent)">
            Klar
          </button>
        </div>

        <section className="grid gap-4 border-b border-(--color-line) px-5 py-4 sm:grid-cols-2">
          <label className="text-xs text-(--color-muted)">
            Namn
            <input
              defaultValue={board.name}
              onBlur={(e) => e.target.value !== board.name && set({ name: e.target.value })}
              className="mt-1 w-full rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            />
          </label>

          <label className="text-xs text-(--color-muted)">
            Veckan börjar på
            <select
              defaultValue={board.weekStartsOn}
              onChange={(e) => set({ weekStartsOn: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            >
              <option value={1}>Måndag</option>
              <option value={0}>Söndag</option>
            </select>
          </label>

          {/* Cykeln låg här förut, en per tavla. Den flyttade till
              kopplingen i bas-schemat: rotationer hör till personer, och
              två på samma tavla kan gå i olika cykler. */}

          <div className="text-xs text-(--color-muted)">
            Dagar som visas
            <div className="mt-1 flex gap-1">
              {WEEKDAYS.map((d) => {
                const on = board.visibleWeekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    disabled={pending}
                    onClick={() => set({ visibleWeekdays: toggle(board.visibleWeekdays, d.value) })}
                    className={`h-7 w-7 rounded border text-xs ${
                      on
                        ? "border-(--color-accent) bg-(--color-accent) text-white"
                        : "border-(--color-line) text-(--color-ink)"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-(--color-muted)">
            Skift
            <div className="mt-1 flex gap-2">
              {(["day", "night"] as Shift[]).map((s) => {
                const on = board.visibleShifts.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={pending}
                    onClick={() => set({ visibleShifts: toggle(board.visibleShifts, s) })}
                    className={`rounded border px-3 py-1 text-xs ${
                      on
                        ? "border-(--color-accent) bg-(--color-accent) text-white"
                        : "border-(--color-line) text-(--color-ink)"
                    }`}
                  >
                    {SHIFT_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-(--color-muted) sm:col-span-2">
            Visas i cellen
            <div className="mt-1 flex gap-2">
              {CELL_FIELDS.map((f) => {
                const on = board.cellFields.includes(f.value);
                return (
                  <button
                    key={f.value}
                    type="button"
                    disabled={pending}
                    onClick={() => set({ cellFields: toggle(board.cellFields, f.value) })}
                    className={`rounded border px-3 py-1 text-xs ${
                      on
                        ? "border-(--color-accent) bg-(--color-accent) text-white"
                        : "border-(--color-line) text-(--color-ink)"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-(--color-line) px-5 py-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Grupprubriker</h3>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-1 rounded border border-(--color-line) px-2 py-1">
                <input
                  defaultValue={g.label}
                  onBlur={(e) =>
                    e.target.value !== g.label &&
                    startTransition(() => renameBoardGroup(g.id, e.target.value, board.slug))
                  }
                  className="w-28 border-none text-sm focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => startTransition(() => deleteBoardGroup(g.id, board.slug))}
                  className="text-xs text-(--color-danger)"
                  title="Raderna blir kvar, utan gruppering"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Ny grupprubrik…"
              className="rounded border border-(--color-line) px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={!newGroup.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  await addBoardGroup(board.id, newGroup, board.slug);
                  setNewGroup("");
                })
              }
              className="rounded border border-(--color-line) px-3 py-1 text-sm disabled:opacity-40"
            >
              Lägg till
            </button>
          </div>
        </section>

        <section className="px-5 py-4">
          <h3 className="text-xs font-semibold tracking-wide uppercase">Rader</h3>
          <DndContext id="rows" sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="mt-2 rounded border border-(--color-line)">
                {ordered.map((row) => (
                  <RowItem
                    key={row.id}
                    row={row}
                    groups={groups}
                    vehicles={vehicles}
                    slug={board.slug}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <div className="mt-3 flex gap-2">
            <input
              value={newRow}
              onChange={(e) => setNewRow(e.target.value)}
              placeholder="Ny rad, t.ex. BT57/58…"
              className="rounded border border-(--color-line) px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={!newRow.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  await addBoardRow({ boardId: board.id, boardSlug: board.slug, label: newRow });
                  setNewRow("");
                })
              }
              className="rounded border border-(--color-line) px-3 py-1 text-sm disabled:opacity-40"
            >
              Lägg till rad
            </button>
          </div>
        </section>

        {canDelete && (
          <section className="border-t border-(--color-line) px-5 py-4">
            <h3 className="text-xs font-semibold tracking-wide text-(--color-danger) uppercase">
              Ta bort tavlan
            </h3>

            {removal === null ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="max-w-[52ch] flex-1 text-xs text-(--color-muted)">
                  Tavlan och allt som hör till den försvinner. Personal, fordon, hämtade pass och
                  registrerad frånvaro påverkas inte — frånvaron hör till personen, inte till tavlan.
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setRemoveError(null);
                      try {
                        setRemoval(await boardRemovalPreview(board.id));
                      } catch {
                        setRemoveError("Kunde inte läsa vad borttagningen skulle omfatta.");
                      }
                    })
                  }
                  className="rounded border border-(--color-danger) px-3 py-1.5 text-sm text-(--color-danger) disabled:opacity-40"
                >
                  Ta bort tavlan…
                </button>
              </div>
            ) : (
              <div className="mt-2 rounded border border-(--color-danger) bg-red-50 p-4">
                <p className="text-sm font-medium text-(--color-danger)">
                  Ta bort {board.name}?
                </p>
                <ul className="mt-2 space-y-0.5 text-sm text-(--color-ink)">
                  <li>
                    {removal.rows} {removal.rows === 1 ? "rad" : "rader"}
                  </li>
                  <li>{removal.assignments} utlagda pass</li>
                  <li>{removal.crew} i bemanningen</li>
                  <li>
                    {removal.baseSchedule} {removal.baseSchedule === 1 ? "rad" : "rader"} i
                    bas-schemat
                  </li>
                </ul>
                <p className="mt-2 text-xs text-(--color-muted)">Det går inte att ångra.</p>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setRemoveError(null);
                        try {
                          await removeBoard(board.id);
                          router.push("/");
                        } catch {
                          setRemoveError("Borttagningen gick inte igenom. Ladda om och försök igen.");
                        }
                      })
                    }
                    className="rounded bg-(--color-danger) px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {pending ? "Tar bort…" : "Ja, ta bort"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setRemoval(null)}
                    className="rounded border border-(--color-line) bg-white px-4 py-1.5 text-sm"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            )}

            {removeError && (
              <p role="alert" className="mt-3 text-sm text-(--color-danger)">
                {removeError}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
