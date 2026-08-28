"use client";

import { Fragment } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { BoardWeek, CellAssignment, WeekRow } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import { shortDayLabel } from "@/lib/week";
import { DIRECTION_ARROW, DIRECTION_LABEL } from "@/lib/transpa/direction";
import { showsDirection } from "@/lib/vehicle-kind";
import type { VehicleKind } from "@/lib/vehicle-kind";
import { personColor } from "@/lib/person-color";
import { ConflictMark } from "./ConflictBadge";
import { SHIFT_ICON, SHIFT_LABEL } from "./shift";
import { dragId } from "./dnd";

export interface DropCheck {
  (target: { boardRowId: string; date: string; shift: Shift }): string | null;
}

/**
 * Riktningen på ett linjepass.
 *
 * Visas bara på linjebilar, för det är bara där två personer kör samma
 * rad samma natt åt var sitt håll. På en bytesbil vore pilen brus.
 *
 * Saknas riktningen står ett tomt streck i stället för ingenting: en
 * benämning som inte sade något ska synas som en lucka att fylla, inte
 * försvinna tyst.
 */
function DirectionMark({ cell }: { cell: CellAssignment }) {
  if (!cell.employeeName) return null;

  /* Okänd riktning tar samma plats men ritar ingenting.
     Platsen behövs för att namnen ska stå i linje — ett hopp i
     vänsterkanten läses som struktur och drar ögat till fel sak. Men en
     synlig markering behövs inte: dagpassen på en linjebil saknar
     nästan alltid riktning, och fem frågetecken i rad tar bara
     uppmärksamhet från de pilar som faktiskt säger något. */
  if (!cell.direction) {
    return (
      <span
        className="inline-block h-4 w-4 shrink-0"
        title="Riktningen står inte i passets benämning i TransPA"
      />
    );
  }

  /* Två saker skiljer upp från ner, inte en: både formen på triangeln
     och färgen. Färgen ensam faller bort i svartvit utskrift och för
     den som inte skiljer rött från grönt; formen ensam är för lik på
     avstånd i ett tätt rutnät. */
  const upp = cell.direction === "upp";
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] leading-none font-bold text-white ${
        upp ? "bg-(--color-dir-up)" : "bg-(--color-dir-down)"
      }`}
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      title={`${DIRECTION_LABEL[cell.direction]} — ur passets benämning i TransPA`}
      aria-label={DIRECTION_LABEL[cell.direction]}
    >
      {DIRECTION_ARROW[cell.direction]}
    </span>
  );
}

function Pass({
  cell,
  vehicleKind,
  onOpen,
}: {
  cell: CellAssignment;
  vehicleKind: VehicleKind;
  onOpen: (cell: CellAssignment) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId.assignment(cell.id),
  });

  /* Kulören hör till personen, inte till cellen: samma person ser
     likadan ut på varje dag och varje rad, så ögat kan följa en linje
     utan att läsa namnen. Tomma pass och fritextnoteringar får ingen
     kulör — det finns ingen att känna igen. */
  const color = cell.employeeId ? personColor(cell.employeeId) : null;

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(cell)}
      style={
        color
          ? {
              backgroundColor: color.bg,
              borderColor: color.border,
              printColorAdjust: "exact",
              WebkitPrintColorAdjust: "exact",
            }
          : undefined
      }
      className={`flex cursor-grab items-center gap-1 rounded border px-1.5 py-0.5 ${
        color ? "" : "border-transparent hover:bg-blue-50"
      } ${isDragging ? "opacity-40" : ""} ${
        cell.source === "generated" ? "" : "font-medium"
      }`}
      title={cell.source === "generated" ? "Från bas-schemat" : "Ändrad för hand"}
    >
      {showsDirection(vehicleKind) && <DirectionMark cell={cell} />}
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

/**
 * Radhuvudet, som också är en släppzon för hela veckan.
 *
 * Släpps en person här läggs hens arbetsdagar ut på raden för hela
 * veckan — en bil bemannas i en rörelse i stället för fem. Zonen tänds
 * bara när det är en person som dras: ett befintligt pass hör hemma i
 * en cell, och att låta det landa på raden vore tvetydigt.
 */
function RowHeader({ row, rowSpan }: { row: BoardWeek["rows"][number]; rowSpan: number }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: dragId.row(row.id) });
  const draggingPerson = String(active?.id ?? "").startsWith("crew:");

  return (
    <th
      ref={setNodeRef}
      scope="row"
      rowSpan={rowSpan}
      className={`sticky left-0 z-10 border-b border-(--color-line) px-3 py-2 text-left font-medium whitespace-nowrap ${
        draggingPerson && isOver
          ? "bg-(--color-accent) text-white"
          : draggingPerson
            ? "bg-amber-50"
            : "bg-white"
      }`}
      style={row.color ? { borderLeft: `3px solid ${row.color}` } : undefined}
    >
      {row.label}
      {draggingPerson && (
        <span className="block text-[10px] font-normal">
          {isOver ? "Släpp → hela veckan" : "hela veckan"}
        </span>
      )}
    </th>
  );
}

function ShiftCell({
  row,
  date,
  shift,
  showVehicle,
  compact,
  onOpen,
  dropCheck,
}: {
  row: WeekRow;
  date: string;
  shift: Shift;
  showVehicle: boolean;
  compact: boolean;
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
      className={`px-2 ${compact ? "min-h-6 py-0.5" : "min-h-9 py-1.5"} ${
        isOver ? (problem ? "bg-red-100 outline outline-(--color-danger)" : "bg-blue-100") : ""
      }`}
    >
      {/* En person per rad, aldrig två sida vid sida. Två namn på samma
          rad blir en klump att läsa i stället för en lista, och de slutar
          dessutom stå i linje med grannkolumnen. */}
      <div className="flex flex-col items-start gap-1">
        {cells.length === 0 ? (
          <span className={`text-(--color-muted) ${compact ? "text-[10px]" : "text-xs"}`}>▢</span>
        ) : (
          cells.map((c) => (
            <Pass key={c.id} cell={c} vehicleKind={row.vehicleKind} onOpen={onOpen} />
          ))
        )}
      </div>
      {showVehicle && vehicle && cells.length > 0 && (
        <div className="mt-0.5 text-xs text-(--color-muted)">{vehicle}</div>
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
            <th className="border-b border-l border-(--color-line) px-2 py-2 text-left font-medium">
              Skift
            </th>
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
                      colSpan={3 + data.dates.length}
                      className="border-b border-(--color-line) bg-gray-100 px-3 py-1 text-xs font-semibold tracking-wide uppercase"
                    >
                      {groupHeader}
                    </td>
                  </tr>
                )}
                {/* En tabellrad per skift, inte en cell med två halvor.
                    Skiftet står då en gång till vänster i stället för som
                    en ikon i var och en av veckans celler, och dagfolket
                    hamnar i linje över hela veckan även när en dag har två
                    nattchaufförer. */}
                {data.shifts.map((shift, i) => {
                  /* En skiftrad utan ett enda pass hela veckan görs smal.
                     De flesta bilar körs bara dagtid, och en tom nattrad i
                     full höjd per sådan bil är mest luft att skrolla förbi.
                     Raden får inte försvinna — den är släppzonen för att
                     lägga ut ett nattpass. */
                  const tomRad = data.dates.every(
                    (d) => (row.cells[`${d}|${shift}`] ?? []).length === 0,
                  );
                  return (
                  /* Raden är adresserbar på bil och skift. En bil spänner
                     numera flera tabellrader, så den som vill åt "hela
                     BT08/09" kan inte längre gå på rubrikcellen ensam. */
                  <tr key={shift} data-row={row.label} data-shift={shift} className="align-top">
                    {i === 0 && (
                      <>
                        <RowHeader row={row} rowSpan={data.shifts.length} />
                        <td
                          rowSpan={data.shifts.length}
                          className="border-b border-(--color-line) px-3 py-2 text-(--color-muted) whitespace-nowrap"
                        >
                          {row.sublabel}
                        </td>
                      </>
                    )}
                    <td
                      className={`border-l border-(--color-line) px-2 text-xs whitespace-nowrap text-(--color-muted) ${
                        tomRad ? "py-0.5" : "py-1.5"
                      } ${
                        i === data.shifts.length - 1 ? "border-b" : ""
                      } ${shift === "night" ? "bg-gray-50" : ""}`}
                    >
                      <span aria-hidden>{SHIFT_ICON[shift]}</span>{" "}
                      {data.shifts.length > 1 ? SHIFT_LABEL[shift] : ""}
                    </td>
                    {data.dates.map((date) => {
                      const inactive = row.inactiveDates.includes(date);
                      return (
                        <td
                          key={date}
                          className={`border-l border-(--color-line) p-0 ${
                            i === data.shifts.length - 1 ? "border-b" : ""
                          } ${inactive ? "bg-gray-50" : shift === "night" ? "bg-gray-50/60" : ""}`}
                        >
                          {inactive ? (
                            <div className="px-3 py-2 text-xs text-(--color-muted)">–</div>
                          ) : (
                            <ShiftCell
                              row={row}
                              date={date}
                              shift={shift}
                              showVehicle={showVehicle}
                              compact={tomRad}
                              onOpen={onOpen}
                              dropCheck={dropCheck}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
