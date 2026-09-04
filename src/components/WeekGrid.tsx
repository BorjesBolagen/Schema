"use client";

import { Fragment } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { BoardWeek, CellAssignment, WeekRow } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import { shortDayLabel } from "@/lib/week";
import { DIRECTION_ARROW, DIRECTION_LABEL } from "@/lib/transpa/direction";
import { showsDirection } from "@/lib/vehicle-kind";
import type { VehicleKind } from "@/lib/vehicle-kind";
import { ConflictMark } from "./ConflictBadge";
import { SHIFT_COLOR, SHIFT_INITIAL, SHIFT_INK, SHIFT_LABEL } from "./shift";
import { dragId } from "./dnd";

export interface DropCheck {
  (target: { boardRowId: string; date: string; shift: Shift }): string | null;
}

/**
 * Riktningen på ett linjepass.
 *
 * Visas bara på linjebilar, för det är bara där två personer kör samma
 * rad samma natt åt var sitt håll. På en bytesbil vore pilen brus.
 * Anropas bara när riktningen faktiskt är känd — se PassMark.
 */
function DirectionMark({ cell }: { cell: CellAssignment & { direction: NonNullable<CellAssignment["direction"]> } }) {
  if (!cell.employeeName) return null;

  /* Två saker skiljer upp från ner, inte en: både formen på triangeln
     och om brickan är fylld eller ljus. Färgen ensam faller bort i
     svartvit utskrift; formen ensam är för lik på avstånd i ett tätt
     rutnät. Båda tonerna hör till nattskiftet, så en nattcell läses som
     natt även innan man hunnit se åt vilket håll resan går. */
  const upp = cell.direction === "upp";
  return (
    <span
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] text-[8px] leading-none font-bold ${
        upp
          ? "bg-(--color-shift-night-ink) text-white"
          : "bg-[#E9EBF6] text-(--color-shift-night-ink)"
      }`}
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      title={`${DIRECTION_LABEL[cell.direction]} — ur passets benämning i TransPA`}
      aria-label={DIRECTION_LABEL[cell.direction]}
    >
      {DIRECTION_ARROW[cell.direction]}
    </span>
  );
}

/**
 * Brickan längst till vänster i ett pass.
 *
 * Riktningen när den finns och bilen är en linjebil — det är bara där
 * två personer kör samma rad samma natt åt var sitt håll, och då är
 * pilen det som skiljer dem åt. Annars skiftets initial.
 *
 * Platsen stod tidigare tom när riktningen saknades, med motiveringen
 * att fem frågetecken i rad tar uppmärksamhet från de pilar som faktiskt
 * säger något. Det gällde när alternativet var ett frågetecken. Ett D
 * säger däremot något i sig, och utan det fick dagpassen på just
 * linjebilarna ingen bricka alls medan alla andra dagpass hade en —
 * samma sorts pass såg olika ut beroende på bilens typ.
 */
function PassMark({
  cell,
  shift,
  vehicleKind,
}: {
  cell: CellAssignment;
  shift: Shift;
  vehicleKind: VehicleKind;
}) {
  if (showsDirection(vehicleKind) && cell.direction) {
    return <DirectionMark cell={{ ...cell, direction: cell.direction }} />;
  }
  if (!cell.employeeName) return null;
  return (
    <span
      aria-hidden
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] text-[8px] leading-none font-bold"
      style={{
        background: SHIFT_COLOR[shift],
        color: shift === "day" ? "var(--color-brand-deep)" : "#fff",
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
      title={SHIFT_LABEL[shift]}
    >
      {SHIFT_INITIAL[shift]}
    </span>
  );
}

function Pass({
  cell,
  shift,
  vehicleKind,
  onOpen,
}: {
  cell: CellAssignment;
  shift: Shift;
  vehicleKind: VehicleKind;
  onOpen: (cell: CellAssignment) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId.assignment(cell.id),
  });

  /* Kulören hör till skiftet, inte till personen.
     Den satt förut på personen: tolv pastellfärger i en egen modul,
     så att ögat kunde följa *en* person genom veckan. Priset var att
     färgen inte betydde något i sig — man fick lära sig att Elin är
     blek blå — och att en tavla med tolv personer blev en färgkarta.
     Omgång 2 byter det mot två färger som säger något utan att läras
     in: varm gul yta är dag, vit med skugga är natt. Vem passet gäller
     står i klartext bredvid.

     Ett pass utan person — en fritextnotering — får ingen fyllning.
     Det är inte ett skift utan en anteckning om ett hål. */
  const namngivet = Boolean(cell.employeeName);
  const dag = shift === "day";

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(cell)}
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      className={`flex w-full min-w-0 cursor-grab items-center gap-1.5 rounded-lg border px-1.5 py-1 text-left ${
        !namngivet
          ? "border-dashed border-(--color-field-line) bg-white"
          : dag
            ? "border-(--color-brand-line) bg-(--color-brand-soft)"
            : "border-(--color-line) bg-white shadow-[0_1px_2px_rgba(34,36,42,.05)]"
      } ${isDragging ? "opacity-40" : ""} ${cell.source === "generated" ? "" : "font-semibold"}`}
      title={cell.source === "generated" ? "Från bas-schemat" : "Ändrad för hand"}
    >
      <PassMark cell={cell} shift={shift} vehicleKind={vehicleKind} />
      {/* Långa namn kapas med ellips i stället för att spränga kolumnen.
          Dagkolumnerna är lika breda, och ett enda långt namn skulle
          annars flytta hela veckan i sidled. */}
      <span
        className={`min-w-0 flex-1 truncate ${namngivet ? "" : "text-(--color-muted) italic"}`}
        title={cell.employeeName ?? undefined}
      >
        {cell.employeeName ?? cell.note ?? "—"}
      </span>
      <ConflictMark conflicts={cell.conflicts} />
      {cell.employeeName && cell.note && (
        <span className="shrink-0 text-xs text-(--color-warn)">{cell.note}</span>
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
      className={`sticky left-0 z-10 border-b border-(--color-line) px-3 py-2 text-left font-bold whitespace-nowrap tabular-nums ${
        draggingPerson && isOver
          ? "bg-(--color-primary) text-white"
          : draggingPerson
            ? "bg-(--color-brand-soft)"
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

  /* Bilnumret under varje namn stod tjugo gånger på en vecka och sa
     samma sak varje gång. Det bär bara upplysning när det *avviker*
     från radens vanliga bil — "BT13/14 körs i dag med BT24" är värt en
     rad, "BT13/14 körs med BT13" är det inte.

     Det som inte avviker tas ändå inte bort: det finns kvar och kommer
     fram när man för musen över cellen, för den som vill se vilken av
     paret som gäller. */
  const avvikandeBil = Boolean(
    vehicle && row.defaultVehicleName && vehicle !== row.defaultVehicleName,
  );

  return (
    <div
      ref={setNodeRef}
      data-cell={`${row.id}|${date}|${shift}`}
      data-shift={shift}
      className={`group/cell px-2 ${compact ? "min-h-6 py-0.5" : "min-h-9 py-1.5"} ${
        isOver ? (problem ? "bg-red-50 outline outline-(--color-danger)" : "bg-(--color-brand-wash)") : ""
      }`}
    >
      {/* En person per rad, aldrig två sida vid sida. Två namn på samma
          rad blir en klump att läsa i stället för en lista, och de slutar
          dessutom stå i linje med grannkolumnen. */}
      <div className="flex flex-col items-stretch gap-1">
        {cells.length === 0
          ? /* Ett tomt pass ska synas som ett hål, inte som vit yta.
               Här stod tidigare ingenting alls utom under en dragning,
               med motiveringen att en ruta i varje ledig cell blir
               tecken som inte betyder något var för sig. Omgång 2 vänder
               på det: hålen i veckan är själva arbetet, och siffran
               "tomma pass kvar" i sidhuvudet säger hur många de är utan
               att visa var. Rutan är avsiktligt tyst — ljus streckad ram
               och ett plus i --color-dim — och tänds först när något
               dras över den.

               Plusset är en markering, inte en knapp: det finns ingen
               väg att skapa ett pass ur en tom cell, och en pekare som
               lovar det vore ett löfte utan täckning. */
            <span
              aria-hidden
              className={`flex w-full items-center justify-center rounded-lg border border-dashed py-1 text-sm leading-none transition ${
                active
                  ? "border-(--color-primary) bg-(--color-field) text-(--color-primary)"
                  : "border-(--color-field-line) text-(--color-dim)"
              }`}
            >
              +
            </span>
          : cells.map((c) => (
              <Pass key={c.id} cell={c} shift={shift} vehicleKind={row.vehicleKind} onOpen={onOpen} />
            ))}
      </div>
      {showVehicle && vehicle && cells.length > 0 && (
        <div
          className={`mt-0.5 text-xs ${
            avvikandeBil
              ? "font-medium text-(--color-warn)"
              : /* Dolt på skärmen, men bara där. Utskriften är samma vy,
                   och den som slagit på bilnummer och sedan skriver ut
                   ska få dem med — ett papper har ingen musmarkör att
                   föra över cellen med. */
                "text-(--color-muted) opacity-0 group-hover/cell:opacity-100 print:opacity-100"
          }`}
        >
          {vehicle}
        </div>
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
    <div className="grid-scroll rounded-xl border border-(--color-line) bg-white">
      {/* Fast tabellayout, så dagkolumnerna blir lika breda spår.
          Med automatisk layout satte webbläsaren bredden efter innehållet:
          en dag med ett långt namn blev bred och en tom dag smal, och
          veckan gick inte att läsa som ett rutnät. Nu räknas spåren ur
          antalet dagar tavlan visar — lägger någon till en dag i tavelns
          inställningar delas bredden om, i stället för att allt flyttar.

          min-w håller spåren läsbara på en smal skärm och låter .grid-scroll
          rulla i stället; i utskrift släpps den, för där finns ingen
          rullning och sidan ska rymmas på bredden. */}
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm print:min-w-0">
        <colgroup>
          <col className="w-[92px]" />
          <col className="w-[140px]" />
          <col className="w-[64px]" />
          {data.dates.map((d) => (
            <col key={d} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-(--color-field)">
            <th className="sticky left-0 z-10 border-b border-(--color-line) bg-(--color-field) px-3 py-2.5 text-left text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase">
              Bil
            </th>
            <th className="border-b border-(--color-line) px-2 py-2.5 text-left text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase">
              Linje
            </th>
            <th className="border-b border-l border-(--color-line-soft) px-2 py-2.5 text-left text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase">
              Skift
            </th>
            {data.dates.map((d) => (
              <th
                key={d}
                className="border-b border-l border-(--color-line-soft) px-2.5 py-2.5 text-left text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase"
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
                      className="border-b border-(--color-line) bg-(--color-chip) px-3 py-1.5 text-[11px] font-bold tracking-[.07em] text-(--color-label) uppercase"
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
                          className="truncate border-b border-(--color-line) px-2 py-2 text-[13px] text-(--color-muted)"
                        >
                          {row.sublabel}
                        </td>
                      </>
                    )}
                    <td
                      className={`border-l border-(--color-line-soft) px-2 text-[11px] font-bold whitespace-nowrap ${
                        tomRad ? "py-0.5" : "py-1.5"
                      } ${i === data.shifts.length - 1 ? "border-b" : ""} ${
                        i > 0 ? "border-t border-dashed border-(--color-line-soft)" : ""
                      }`}
                      style={{ color: SHIFT_INK[shift] }}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{
                            background: SHIFT_COLOR[shift],
                            printColorAdjust: "exact",
                            WebkitPrintColorAdjust: "exact",
                          }}
                        />
                        {data.shifts.length > 1 ? SHIFT_LABEL[shift] : ""}
                      </span>
                    </td>
                    {data.dates.map((date) => {
                      const inactive = row.inactiveDates.includes(date);
                      return (
                        <td
                          key={date}
                          className={`border-l border-(--color-line-soft) p-0 ${
                            i === data.shifts.length - 1 ? "border-b" : ""
                          } ${i > 0 ? "border-t border-dashed border-(--color-line-soft)" : ""} ${
                            inactive ? "bg-(--color-field)" : ""
                          }`}
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
