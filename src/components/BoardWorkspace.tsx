"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { BoardWeek, CellAssignment } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import {
  assignEmployee,
  assignEmployeeWeek,
  fetchShiftsForWeek,
  fillWeek,
  moveAssignment,
  removeAssignment,
  type FillResult,
  type WeekPlacement,
  type ShiftFetchResult,
} from "@/app/actions";
import { WeekGrid } from "./WeekGrid";
import { CrewPanel } from "./CrewPanel";
import { CrewPicker, type PickerEmployee } from "./CrewPicker";
import { AssignmentEditor } from "./AssignmentEditor";
import { BoardEditor } from "./BoardEditor";
import { BaseScheduleEditor } from "./BaseScheduleEditor";
import { WorkPatternEditor } from "./WorkPatternEditor";
import { parseDragId, parseDropId } from "./dnd";

interface Props {
  data: BoardWeek;
  allEmployees: PickerEmployee[];
  /** Bara administratörer får ta bort en tavla — se removeBoard(). */
  canDelete?: boolean;
}

/**
 * Vad pekaren står över vinner.
 *
 * dnd-kits standard (rectIntersection) mäter det dragna elementets
 * rektangel, inte pekaren. Radhuvudet ligger kant i kant med veckans
 * första cell, så en dragning som siktade på raden landade i cellen
 * i stället — hela veckan blev en enda dag. rectIntersection finns kvar
 * som reserv för tangentbordsdragning, där ingen pekare finns.
 */
const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

export function BoardWorkspace({ data, allEmployees, canDelete = false }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [open, setOpen] = useState<CellAssignment | null>(null);
  const [picker, setPicker] = useState(false);
  type Panel = "board" | "base" | "patterns" | null;
  const [panel, setPanel] = useState<Panel>(null);
  const [fillReport, setFillReport] = useState<FillResult | null>(null);
  const [weekPlacement, setWeekPlacement] = useState<(WeekPlacement & { name: string }) | null>(
    null,
  );
  const [shiftFetch, setShiftFetch] = useState<ShiftFetchResult | null>(null);

  /**
   * Hämtar veckans pass ur TransPA för bemanningen.
   *
   * En vecka, en person i taget, på knapptryck. Passen skrivs till
   * databasen och tavlan läser dem därifrån — renderingen rör aldrig
   * nätet, eftersom ett trögt TransPA annars fäller hela sidan.
   */
  function loadShifts() {
    setShiftFetch(null);
    startTransition(async () => {
      setShiftFetch(
        await fetchShiftsForWeek({ boardSlug: data.board.slug, year: data.year, week: data.week }),
      );
    });
  }

  /** Namnet på en person, oavsett om hen redan är med i bemanningen. */
  const nameOf = (employeeId: string) =>
    data.crew.find((c) => c.employeeId === employeeId)?.name ??
    allEmployees.find((e) => e.id === employeeId)?.name ??
    "Personen";
  const [pending, startTransition] = useTransition();

  /* ⇧ under dragningen kopierar i stället för att flytta. */
  const copyRef = useRef(false);
  useEffect(() => {
    const set = (e: KeyboardEvent) => (copyRef.current = e.shiftKey);
    window.addEventListener("keydown", set);
    window.addEventListener("keyup", set);
    return () => {
      window.removeEventListener("keydown", set);
      window.removeEventListener("keyup", set);
    };
  }, []);

  const sensors = useSensors(
    // Liten tröskel så ett klick på ett pass inte startar en dragning.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const employeeOf = useCallback(
    (source: ReturnType<typeof parseDragId>): string | null => {
      if (!source) return null;
      if (source.kind === "crew") return source.employeeId;
      for (const row of data.rows) {
        for (const cells of Object.values(row.cells)) {
          const hit = cells.find((c) => c.id === source.assignmentId);
          if (hit) return hit.employeeId;
        }
      }
      return null;
    },
    [data.rows],
  );

  /**
   * Varför en släppning skulle bli fel — räknas ut redan under
   * dragningen så problemet syns innan man släpper, inte efter.
   */
  const dropCheck = useCallback(
    (target: { boardRowId: string; date: string; shift: Shift }): string | null => {
      const employeeId = employeeOf(parseDragId(dragging ?? ""));
      if (!employeeId) return null;

      const member = data.crew.find((c) => c.employeeId === employeeId);
      if (member?.absence) {
        const { fromDate, toDate, type } = member.absence;
        if (target.date >= fromDate && target.date <= toDate) return type;
      }

      for (const row of data.rows) {
        const cells = row.cells[`${target.date}|${target.shift}`] ?? [];
        for (const c of cells) {
          if (c.employeeId !== employeeId) continue;
          if (row.id === target.boardRowId) return null; // redan i cellen
          return `Står redan på ${row.label}`;
        }
      }

      if (member && !member.workDays.some((w) => w.date === target.date)) {
        return "Jobbar inte den dagen";
      }
      return null;
    },
    [dragging, data.crew, data.rows, employeeOf],
  );

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const source = parseDragId(String(event.active.id));
    const target = event.over ? parseDropId(String(event.over.id)) : null;
    if (!source || !target) return;

    const copy = copyRef.current;
    startTransition(async () => {
      if (target.kind === "crew-panel") {
        if (source.kind === "assignment") {
          await removeAssignment(source.assignmentId, data.board.slug);
        }
        return;
      }
      /* Radhuvudet lägger ut hela veckan; en cell lägger ut en dag.
         Ett befintligt pass kan bara flyttas till en cell — att släppa
         det på raden vore tvetydigt. */
      if (target.kind === "row") {
        if (source.kind !== "crew") return;
        const result = await assignEmployeeWeek({
          boardRowId: target.boardRowId,
          employeeId: source.employeeId,
          year: data.year,
          week: data.week,
          boardSlug: data.board.slug,
        });
        setWeekPlacement({ name: nameOf(source.employeeId), ...result });
        return;
      }

      if (source.kind === "crew") {
        await assignEmployee({
          boardRowId: target.boardRowId,
          date: target.date,
          shift: target.shift,
          employeeId: source.employeeId,
          boardSlug: data.board.slug,
        });
      } else {
        await moveAssignment({
          assignmentId: source.assignmentId,
          boardRowId: target.boardRowId,
          date: target.date,
          shift: target.shift,
          copy,
          boardSlug: data.board.slug,
        });
      }
    });
  }

  const draggedLabel = (() => {
    const employeeId = employeeOf(parseDragId(dragging ?? ""));
    return data.crew.find((c) => c.employeeId === employeeId)?.name ?? "Pass";
  })();

  return (
    <DndContext
      // Fast id så serverns och klientens aria-attribut blir lika.
      id="board"
      collisionDetection={collisionDetection}
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 no-print">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setFillReport(
                await fillWeek({
                  boardId: data.board.id,
                  boardSlug: data.board.slug,
                  year: data.year,
                  week: data.week,
                }),
              );
            })
          }
          className="rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Fyll veckan
        </button>
        <span className="text-xs text-(--color-muted)">
          Arbetsdagar från: {data.workDaySource}
        </span>
        {fillReport && (
          <span className="text-xs text-(--color-muted)">
            {fillReport.created} pass utlagda
            {fillReport.unplaced.length > 0 &&
              `, ${new Set(fillReport.unplaced.map((u) => u.employeeId)).size} personer utan bil`}
          </span>
        )}

        {weekPlacement && (
          <span
            className={`text-xs ${
              weekPlacement.missingPattern ? "text-(--color-warn)" : "text-(--color-muted)"
            }`}
          >
            {weekPlacement.missingPattern ? (
              <>
                {weekPlacement.name} saknar arbetsmönster — inget lades ut. Sätt mönstret under
                Arbetsmönster först.
              </>
            ) : (
              <>
                {weekPlacement.name}: {weekPlacement.placed} pass utlagda
                {weekPlacement.skipped.some((x) => x.reason === "frånvaro") &&
                  `, ${weekPlacement.skipped.filter((x) => x.reason === "frånvaro").length} dagar frånvaro`}
                {/* Noll utlagda när allt redan står där är inte samma
                    sak som noll för att inget gick att lägga ut. */}
                {weekPlacement.skipped.some((x) => x.reason === "redan utlagd") &&
                  `, ${
                    weekPlacement.skipped.filter((x) => x.reason === "redan utlagd").length
                  } dagar stod redan på raden`}
                {weekPlacement.addedToCrew && ", tillagd i bemanningen"}
              </>
            )}
          </span>
        )}

        <button
          type="button"
          onClick={loadShifts}
          disabled={pending}
          className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          title="Hämtar veckans pass ur TransPA för de personer tavlan hanterar"
        >
          {pending ? "Hämtar …" : "Hämta schema"}
        </button>

        {shiftFetch && (
          <span
            className={`text-xs ${
              shiftFetch.ok ? "text-(--color-muted)" : "text-(--color-danger)"
            }`}
          >
            {shiftFetch.error && !shiftFetch.ok
              ? `Kunde inte hämta: ${shiftFetch.error}`
              : `${shiftFetch.shifts} pass för ${shiftFetch.withShifts} av ${shiftFetch.asked} personer`}
            {shiftFetch.unlinked > 0 && `, ${shiftFetch.unlinked} utan TransPA-koppling`}
            {shiftFetch.failed > 0 && shiftFetch.ok && `, ${shiftFetch.failed} misslyckades`}
          </span>
        )}

        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setPanel("base")}
            className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm"
          >
            Bas-schema
          </button>
          <button
            type="button"
            onClick={() => setPanel("patterns")}
            className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm"
          >
            Arbetsmönster
          </button>
          <button
            type="button"
            onClick={() => setPanel("board")}
            className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm"
          >
            ⚙ Tavla
          </button>
        </span>
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <WeekGrid data={data} onOpen={setOpen} dropCheck={dropCheck} />
        </div>
        <CrewPanel
          crew={data.crew}
          dates={data.dates}
          allEmployees={allEmployees}
          onOpenPicker={() => setPicker(true)}
        />
      </div>

      <DragOverlay>
        {dragging && (
          <span className="rounded bg-(--color-accent) px-2 py-1 text-sm text-white shadow-lg">
            {draggedLabel}
          </span>
        )}
      </DragOverlay>

      {picker && (
        <CrewPicker
          boardId={data.board.id}
          boardSlug={data.board.slug}
          employees={allEmployees}
          selected={data.crew.map((c) => c.employeeId)}
          onClose={() => setPicker(false)}
        />
      )}

      {open && (
        <AssignmentEditor cell={open} boardSlug={data.board.slug} onClose={() => setOpen(null)} />
      )}

      {panel === "board" && (
        <BoardEditor
          board={{
            id: data.board.id,
            slug: data.board.slug,
            name: data.board.name,
            weekStartsOn: data.board.weekStartsOn,
            visibleWeekdays: data.board.visibleWeekdays,
            visibleShifts: data.board.visibleShifts,
            cellFields: data.board.cellFields,
          }}
          canDelete={canDelete}
          rows={data.rows.map((r) => ({
            id: r.id,
            label: r.label,
            sublabel: r.sublabel,
            groupId: r.groupId,
            color: r.color,
            defaultVehicleId: r.defaultVehicleId,
            validTo: r.validTo,
          }))}
          groups={data.groups}
          vehicles={data.vehicles}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "base" && <BaseScheduleEditor data={data} onClose={() => setPanel(null)} />}
      {panel === "patterns" && <WorkPatternEditor data={data} onClose={() => setPanel(null)} />}
    </DndContext>
  );
}
