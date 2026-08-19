"use client";

import { useMemo, useState, useTransition } from "react";
import type { BoardWeek } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import { saveWorkPattern, type PatternDayInput } from "@/app/actions";
import { mondayOfWeek } from "@/lib/week";
import { SHIFT_ICON, SHIFT_LABEL } from "./shift";

const WEEKDAYS = [
  { value: 1, label: "Mån" },
  { value: 2, label: "Tis" },
  { value: 3, label: "Ons" },
  { value: 4, label: "Tors" },
  { value: 5, label: "Fre" },
  { value: 6, label: "Lör" },
  { value: 0, label: "Sön" },
];

const key = (cycleWeek: number, weekday: number, shift: Shift) => `${cycleWeek}|${weekday}|${shift}`;

/**
 * Arbetsmönster per person.
 *
 * Reservkällan tills TransPA kan leverera arbetsdagar. En cykel på en
 * vecka är ett vanligt veckoschema; längre cykler täcker roterande
 * upplägg av typen pass 1–4. När hämtningen finns tar den över för de
 * personer TransPA har besked om, och mönstret blir kvar för resten.
 */
export function WorkPatternEditor({ data, onClose }: { data: BoardWeek; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState(data.crew[0]?.employeeId ?? "");
  const existing = data.patterns.find((p) => p.employeeId === employeeId);

  const [cycleWeeks, setCycleWeeks] = useState(existing?.cycleWeeks ?? 1);
  const [weekStartsOn, setWeekStartsOn] = useState(existing?.weekStartsOn ?? 1);
  const [picked, setPicked] = useState<Set<string>>(
    new Set((existing?.days ?? []).map((d) => key(d.cycleWeek, d.weekday, d.shift))),
  );
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  /** Byter person och läser in hens mönster. */
  function select(id: string) {
    const p = data.patterns.find((x) => x.employeeId === id);
    setEmployeeId(id);
    setCycleWeeks(p?.cycleWeeks ?? 1);
    setWeekStartsOn(p?.weekStartsOn ?? 1);
    setPicked(new Set((p?.days ?? []).map((d) => key(d.cycleWeek, d.weekday, d.shift))));
    setSaved(false);
  }

  const toggle = (cycleWeek: number, weekday: number, shift: Shift) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const k = key(cycleWeek, weekday, shift);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
    setSaved(false);
  };

  const days: PatternDayInput[] = useMemo(
    () =>
      [...picked].map((k) => {
        const [cw, wd, sh] = k.split("|");
        return { cycleWeek: Number(cw), weekday: Number(wd), shift: sh as Shift };
      }),
    [picked],
  );

  const anchorDate = existing?.anchorDate ?? mondayOfWeek(data.year, 1);
  const shifts = data.shifts.length ? data.shifts : (["day"] as Shift[]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <div className="w-full max-w-3xl rounded-lg border border-(--color-line) bg-white shadow-xl">
        <div className="flex items-baseline justify-between border-b border-(--color-line) px-5 py-3">
          <h2 className="font-medium">Arbetsmönster</h2>
          <button type="button" onClick={onClose} className="text-sm text-(--color-accent)">
            Klar
          </button>
        </div>

        <p className="border-b border-(--color-line) bg-gray-50 px-5 py-2 text-xs text-(--color-muted)">
          Vilka dagar personen jobbar. Används tills arbetsdagarna kan hämtas från TransPA — då tar
          hämtningen över för de personer TransPA har besked om.
        </p>

        <div className="flex flex-wrap items-end gap-4 border-b border-(--color-line) px-5 py-4">
          <label className="text-xs text-(--color-muted)">
            Person
            <select
              value={employeeId}
              onChange={(e) => select(e.target.value)}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            >
              {data.crew.map((c) => (
                <option key={c.employeeId} value={c.employeeId}>
                  {c.name}
                  {data.patterns.some((p) => p.employeeId === c.employeeId) ? "" : "  (saknar mönster)"}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-(--color-muted)">
            Cykel
            <select
              value={cycleWeeks}
              onChange={(e) => {
                setCycleWeeks(Number(e.target.value));
                setSaved(false);
              }}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Samma varje vecka" : `${n} veckor`}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-(--color-muted)">
            Veckan börjar på
            <select
              value={weekStartsOn}
              onChange={(e) => {
                setWeekStartsOn(Number(e.target.value));
                setSaved(false);
              }}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
              title="Söndag betyder att söndagen hör ihop med måndagen som följer"
            >
              <option value={1}>Måndag</option>
              <option value={0}>Söndag</option>
            </select>
          </label>
        </div>

        <div className="space-y-4 px-5 py-4">
          {Array.from({ length: cycleWeeks }, (_, cw) => (
            <div key={cw}>
              {cycleWeeks > 1 && (
                <h3 className="mb-1 text-xs font-semibold tracking-wide uppercase">
                  Vecka {cw + 1} i cykeln
                </h3>
              )}
              <table className="border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-16" />
                    {WEEKDAYS.map((d) => (
                      <th key={d.value} className="px-2 py-1 text-xs font-medium text-(--color-muted)">
                        {d.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <tr key={shift}>
                      <th className="pr-2 text-right text-xs font-medium text-(--color-muted)">
                        {SHIFT_ICON[shift]} {SHIFT_LABEL[shift]}
                      </th>
                      {WEEKDAYS.map((d) => {
                        const on = picked.has(key(cw, d.value, shift));
                        return (
                          <td key={d.value} className="px-1 py-0.5">
                            <button
                              type="button"
                              onClick={() => toggle(cw, d.value, shift)}
                              aria-pressed={on}
                              aria-label={`${d.label} ${SHIFT_LABEL[shift]}`}
                              className={`h-7 w-11 rounded border text-xs ${
                                on
                                  ? "border-(--color-accent) bg-(--color-accent) text-white"
                                  : "border-(--color-line) bg-white"
                              }`}
                            >
                              {on ? SHIFT_ICON[shift] : ""}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-(--color-line) px-5 py-3">
          <span className="text-xs text-(--color-muted)">
            {days.length} pass per cykel
            {saved && <span className="ml-2 text-(--color-accent)">✓ sparat</span>}
          </span>
          <button
            type="button"
            disabled={!employeeId || pending}
            onClick={() =>
              startTransition(async () => {
                await saveWorkPattern({
                  employeeId,
                  cycleWeeks,
                  anchorDate,
                  weekStartsOn,
                  days,
                  boardSlug: data.board.slug,
                });
                setSaved(true);
              })
            }
            className="rounded bg-(--color-accent) px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Spara mönster
          </button>
        </div>
      </div>
    </div>
  );
}
