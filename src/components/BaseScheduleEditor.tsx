"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import type { BoardWeek } from "@/server/board-week";
import {
  addBaseScheduleEntry,
  removeBaseScheduleEntry,
  reorderBaseSchedule,
  setBaseScheduleRule,
} from "@/app/actions";
import { cyclePosition, describeRule, kommandeVeckor, MAX_CYCLE_WEEKS } from "@/lib/rotation";

/**
 * Bas-schemat: den stående kopplingen person ↔ bil.
 *
 * Här står inga dagar, och det är avsiktligt. Flera personer får
 * kopplas till samma rad — vem som faktiskt står där en viss dag avgörs
 * av deras arbetsdagar. Det är så BT13/14 kan bemannas av en person
 * fyra dagar och av en annan den femte utan att någon skriver in det.
 */
/** Måndag först — så läses ett schema. */
const VECKODAGAR: Array<[number, string]> = [
  [1, "Mån"],
  [2, "Tis"],
  [3, "Ons"],
  [4, "Tors"],
  [5, "Fre"],
  [6, "Lör"],
  [0, "Sön"],
];

/**
 * När en koppling gäller.
 *
 * Veckodagar, hur ofta, och — när det är mer sällan än varje vecka —
 * vilka veckor i cykeln. Ingenting ikryssat betyder alltid, vilket sägs
 * rakt ut i stället för att lämnas åt gissning: det är den vanligaste
 * inställningen och den minst uppenbara.
 *
 * Cykeln hör till kopplingen, inte till tavlan. Samma person kan gå
 * varannan vecka på en bil och var fjärde på en annan, och två personer
 * på samma tavla kan ha helt olika cykler. Låg längden på tavlan gick
 * det inte att skriva ned.
 *
 * De veckor regeln faktiskt träffar räknas ut och visas. Ett cykelnummer
 * säger ingenting i sig — "vecka 2 av 4" är sant men obekräftbart, medan
 * "v. 36, 40, 44" går att hålla mot schemat man redan har.
 */
function RuleEditor({
  entry,
  year,
  week,
  pending,
  onSave,
  onClose,
}: {
  entry: {
    cycleWeeks: number[] | null;
    weekdays: number[] | null;
    cycleLength: number;
    cycleOffset: number;
  };
  /** Veckan tavlan visar, för att kunna räkna ut vilka veckor regeln träffar. */
  year: number;
  week: number;
  pending: boolean;
  onSave: (v: {
    cycleWeeks: number[];
    weekdays: number[];
    cycleLength: number;
    cycleOffset: number;
  }) => void;
  onClose: () => void;
}) {
  const [weekdays, setWeekdays] = useState<number[]>(entry.weekdays ?? []);
  const [cycleWeeks, setCycleWeeks] = useState<number[]>(entry.cycleWeeks ?? []);
  const [cycleLength, setCycleLength] = useState<number>(entry.cycleLength);
  const [cycleOffset, setCycleOffset] = useState<number>(entry.cycleOffset);

  const toggle = (list: number[], set: (v: number[]) => void, value: number) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const Chip = ({
    on,
    label,
    onClick,
  }: {
    on: boolean;
    label: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs ${
        on
          ? "border-(--color-accent) bg-(--color-primary) text-white"
          : "border-(--color-line) bg-white text-(--color-muted) hover:border-(--color-accent)"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-xs text-(--color-muted)">Veckodagar</span>
        {VECKODAGAR.map(([n, label]) => (
          <Chip
            key={n}
            on={weekdays.includes(n)}
            label={label}
            onClick={() => toggle(weekdays, setWeekdays, n)}
          />
        ))}
        {weekdays.length === 0 && (
          <span className="text-xs text-(--color-muted)">inga valda = alla dagar</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-xs text-(--color-muted)">Hur ofta</span>
        {[1, 2, 3, 4, 6, 8].map((n) => (
          <Chip
            key={n}
            on={cycleLength === n}
            label={n === 1 ? "varje vecka" : `var ${n}:e`}
            onClick={() => {
              setCycleLength(n);
              /* Valda cykelveckor som inte ryms i den nya längden
                 skulle bli en regel som aldrig träffar. */
              setCycleWeeks((v) => v.filter((x) => x <= n));
              setCycleOffset((v) => v % n);
            }}
          />
        ))}
      </div>

      {cycleLength > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs text-(--color-muted)">Cykelvecka</span>
          {Array.from({ length: Math.min(cycleLength, MAX_CYCLE_WEEKS) }, (_, i) => i + 1).map(
            (n) => (
              <Chip
                key={n}
                on={cycleWeeks.includes(n)}
                label={String(n)}
                onClick={() => toggle(cycleWeeks, setCycleWeeks, n)}
              />
            ),
          )}
          {cycleWeeks.length === 0 && (
            <span className="text-xs text-(--color-muted)">inga valda = alla veckor</span>
          )}
        </div>
      )}

      {cycleLength > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs text-(--color-muted)">Förskjutning</span>
          {Array.from({ length: cycleLength }, (_, i) => i).map((o) => (
            <Chip
              key={o}
              on={cycleOffset === o}
              label={`v.${week} = ${cyclePosition(week, cycleLength, o)}`}
              onClick={() => setCycleOffset(o)}
            />
          ))}
        </div>
      )}

      {/* Vilka veckor regeln faktiskt träffar. Ett cykelnummer är sant
          men obekräftbart; veckonumren går att hålla mot det schema
          planeraren redan har. */}
      <p className="text-xs text-(--color-muted)">
        {cycleLength === 1
          ? "Gäller varje vecka."
          : `Gäller v. ${kommandeVeckor({ year, week, cycleLength, cycleOffset, cycleWeeks }).join(
              ", ",
            )} …`}
      </p>

      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave({ cycleWeeks, weekdays, cycleLength, cycleOffset })}
          className="rounded bg-(--color-primary) px-3 py-1 text-white disabled:opacity-50"
        >
          {pending ? "Sparar …" : "Spara"}
        </button>
        <button type="button" onClick={onClose} className="text-(--color-muted) hover:underline">
          Avbryt
        </button>
        {cycleLength === 1 && (
          <span className="text-(--color-muted)">
            Välj hur ofta ovan för att kunna peka ut enskilda veckor i en cykel.
          </span>
        )}
      </div>
    </div>
  );
}

export function BaseScheduleEditor({
  data,
  onClose,
}: {
  data: BoardWeek;
  onClose: () => void;
}) {
  const [rowId, setRowId] = useState(data.rows[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState(data.crew[0]?.employeeId ?? "");
  const [pending, startTransition] = useTransition();
  /** Vilken kopplings regel som redigeras. Null = ingen. */
  const [oppen, setOppen] = useState<string | null>(null);

  const nameOf = (id: string) =>
    data.crew.find((c) => c.employeeId === id)?.name ??
    data.personRows.find((p) => p.employeeId === id)?.name ??
    "Okänd";
  const rowOf = (id: string) => data.rows.find((r) => r.id === id);

  /**
   * Tabellen grupperas på person, för det är där ordningen betyder
   * något: den avgör vilken bil som vinner när flera kopplingar gäller
   * samma dag. Sorterad på rad-etikett, som tidigare, gick det inte att
   * se vilka som konkurrerade med varandra.
   *
   * Grupperingen tog förut med skiftet i nyckeln. Kopplingen har inget
   * skift längre — alla en persons kopplingar konkurrerar med varandra,
   * oavsett om passet visar sig bli dag eller natt.
   */
  const ordnade = useMemo(() => {
    const grupper = new Map<string, typeof data.baseSchedule>();
    for (const e of data.baseSchedule) {
      const key = e.employeeId;
      grupper.set(key, [...(grupper.get(key) ?? []), e]);
    }
    for (const [, g] of grupper) g.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

    return [...grupper.values()]
      .sort((a, b) => nameOf(a[0].employeeId).localeCompare(nameOf(b[0].employeeId), "sv"))
      .flatMap((syskon) => syskon.map((entry, index) => ({ entry, syskon, index })));
    // nameOf läser data, som är hela beroendet.
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Byter plats på två kopplingar och skriver om hela gruppens ordning. */
  const flytta = (syskon: typeof data.baseSchedule, index: number, steg: number) => {
    const ids = syskon.map((e) => e.id);
    [ids[index], ids[index + steg]] = [ids[index + steg], ids[index]];
    startTransition(() => reorderBaseSchedule({ boardSlug: data.board.slug, ids }));
  };

  const canAdd =
    rowId &&
    employeeId &&
    !data.baseSchedule.some(
      (b) => b.boardRowId === rowId && b.employeeId === employeeId,
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
              <th className="px-5 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Rad</th>
              <th className="px-3 py-2 font-medium">Gäller</th>
              <th className="px-3 py-2 font-medium">Ordning</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.baseSchedule.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-sm text-(--color-muted)">
                  Inget bas-schema ännu. Koppla en person till en bil nedan.
                </td>
              </tr>
            )}
            {ordnade.map(({ entry, syskon, index }) => (
              <Fragment key={entry.id}>
              <tr className="border-t border-(--color-line)">
                <td className="px-5 py-1.5 font-medium">{nameOf(entry.employeeId)}</td>
                <td className="px-3 py-1.5">{rowOf(entry.boardRowId)?.label ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setOppen(oppen === entry.id ? null : entry.id)}
                    className={`rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 ${
                      describeRule(entry, entry.cycleLength) === "alltid"
                        ? "text-(--color-muted)"
                        : "font-medium text-(--color-accent)"
                    }`}
                    title="Ändra när kopplingen gäller"
                  >
                    {describeRule(entry, entry.cycleLength)} ▾
                  </button>
                </td>
                <td className="px-3 py-1.5">
                  {/* Ordningen betyder bara något när personen är kopplad
                      till mer än en bil på samma skift. Där den inte gör
                      det ska den inte heller synas som ett val. */}
                  {syskon.length < 2 ? (
                    <span className="text-xs text-(--color-muted)">—</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs">
                      <span
                        className={index === 0 ? "font-semibold" : "text-(--color-muted)"}
                        title={index === 0 ? "Vinner när båda gäller samma dag" : undefined}
                      >
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        disabled={pending || index === 0}
                        onClick={() => flytta(syskon, index, -1)}
                        aria-label="Flytta upp"
                        className="px-0.5 leading-none disabled:opacity-25"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={pending || index === syskon.length - 1}
                        onClick={() => flytta(syskon, index, 1)}
                        aria-label="Flytta ner"
                        className="px-0.5 leading-none disabled:opacity-25"
                      >
                        ▼
                      </button>
                    </span>
                  )}
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
              {oppen === entry.id && (
                <tr className="bg-gray-50">
                  <td colSpan={5} className="px-5 py-3">
                    <RuleEditor
                      entry={entry}
                      year={data.year}
                      week={data.week}
                      pending={pending}
                      onSave={(v) =>
                        startTransition(async () => {
                          await setBaseScheduleRule({
                            boardSlug: data.board.slug,
                            id: entry.id,
                            ...v,
                          });
                          setOppen(null);
                        })
                      }
                      onClose={() => setOppen(null)}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
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

          <button
            type="button"
            disabled={!canAdd || pending}
            onClick={() =>
              startTransition(() =>
                addBaseScheduleEntry({
                  boardRowId: rowId,
                  employeeId,
                  validFrom: null,
                  boardSlug: data.board.slug,
                }),
              )
            }
            className="rounded bg-(--color-primary) px-3 py-1.5 text-sm text-white disabled:opacity-40"
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
