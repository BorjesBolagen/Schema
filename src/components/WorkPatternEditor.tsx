"use client";

import { useMemo, useState, useTransition } from "react";
import type { BoardWeek } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import {
  applyWorkPatternToMany,
  saveWorkPattern,
  suggestPatternsForBoard,
  type PatternDayInput,
} from "@/app/actions";
import type { PatternSuggestion } from "@/lib/trip-patterns";
import type { SuggestionReport } from "@/server/transpa-work-days";
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
  const [saved, setSaved] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [suggestions, setSuggestions] = useState<PatternSuggestion[] | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [report, setReport] = useState<SuggestionReport | null>(null);

  const mine = suggestions?.find((s) => s.employeeId === employeeId);

  /**
   * Hämtar turhistoriken för hela bemanningen på en gång.
   *
   * Ett anrop för alla, inte ett per person: turerna hämtas ändå i en
   * fråga per bolag, och planeraren ska kunna bläddra mellan personer
   * utan att vänta på nätverket varje gång.
   */
  function fetchSuggestions() {
    setSuggestNote(null);
    startTransition(async () => {
      const report = await suggestPatternsForBoard({ boardSlug: data.board.slug });
      if (!report.ok) {
        setSuggestNote(`Kunde inte läsa turhistoriken: ${report.error}`);
        return;
      }
      setSuggestions(report.suggestions);
      setReport(report);

      /* Antalet turer säger inget i sig — det som avgör om underlaget
         duger är hur många personer de fördelar sig på. */
      setSuggestNote(
        report.linked === 0
          ? "Ingen i bemanningen är kopplad till TransPA. Kör synken under TransPA-anslutning först."
          : `${report.trips} turer på ${report.weeksBack} veckor, för ${report.withTrips} av ${report.linked} personer.`,
      );
    });
  }

  /** Fyller i förslaget i rutnätet. Sparas först när planeraren sparar. */
  function useSuggestion(suggestion: PatternSuggestion) {
    setCycleWeeks(1);
    setPicked(new Set(suggestion.days.map((d) => key(0, d.weekday, d.shift))));
    setSaved(null);
  }

  /** Byter person och läser in hens mönster. */
  function select(id: string) {
    const p = data.patterns.find((x) => x.employeeId === id);
    setEmployeeId(id);
    setCycleWeeks(p?.cycleWeeks ?? 1);
    setWeekStartsOn(p?.weekStartsOn ?? 1);
    setPicked(new Set((p?.days ?? []).map((d) => key(d.cycleWeek, d.weekday, d.shift))));
    setSaved(null);
  }

  const toggle = (cycleWeek: number, weekday: number, shift: Shift) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const k = key(cycleWeek, weekday, shift);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
    setSaved(null);
  };

  const days: PatternDayInput[] = useMemo(
    () =>
      [...picked].map((k) => {
        const [cw, wd, sh] = k.split("|");
        return { cycleWeek: Number(cw), weekday: Number(wd), shift: sh as Shift };
      }),
    [picked],
  );

  /**
   * Vilka "Använd på …" träffar. Utan kryssrutan bara de som saknar
   * mönster — så knappen går att trycka på utan att råka skriva om
   * någons rullschema.
   */
  const targets = useMemo(
    () =>
      data.crew
        .filter((c) => overwrite || !data.patterns.some((p) => p.employeeId === c.employeeId))
        .map((c) => c.employeeId),
    [data.crew, data.patterns, overwrite],
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
          Vilka dagar personen jobbar. TransPA levererar inga planerade pass — det är kontrollerat
          — så mönstret här är källan. Turhistoriken kan däremot föreslå det åt dig.
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
                setSaved(null);
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
                setSaved(null);
              }}
              className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
              title="Söndag betyder att söndagen hör ihop med måndagen som följer"
            >
              <option value={1}>Måndag</option>
              <option value={0}>Söndag</option>
            </select>
          </label>
        </div>

        <div className="border-b border-(--color-line) px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={fetchSuggestions}
              disabled={pending}
              className="rounded border border-(--color-line) px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {pending ? "Läser turhistoriken …" : "Föreslå ur turhistoriken"}
            </button>
            {suggestNote && <span className="text-xs text-(--color-muted)">{suggestNote}</span>}
          </div>

          {/* Tystnad är inte ett svar. Har den valda personen inga turer
              såg det ut som att knappen inte gjorde något — vilket den
              hade gjort, för alla utom hen. */}
          {report?.ok && !mine && (
            <p className="mt-3 rounded border border-(--color-line) bg-gray-50 p-3 text-xs text-(--color-warn)">
              Inga turer för den här personen de senaste {report.weeksBack} veckorna. Mönstret får
              fyllas i för hand nedan.
              {report.withTrips === 0 && report.linked > 0 && (
                <>
                  {" "}
                  Ingen av de {report.linked} personerna hade några turer heller — turhistoriken bär
                  troligen inte arbetsdagar hos er, utan bara traktamentsgrundande resor.
                </>
              )}
            </p>
          )}

          {mine && (
            <div className="mt-3 rounded border border-(--color-line) bg-gray-50 p-3 text-xs">
              {mine.confidence === "otillräcklig" ? (
                <p className="text-(--color-warn)">
                  Bara {mine.weeksObserved} vecka{mine.weeksObserved === 1 ? "" : "or"} med turer —
                  för tunt underlag för att föreslå ett mönster.
                </p>
              ) : mine.days.length === 0 ? (
                <p className="text-(--color-warn)">
                  Turerna följer inget tydligt veckomönster. Dagarna nedan förekommer, men för
                  oregelbundet för att fyllas i åt dig.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Kör{" "}
                    <strong>
                      {mine.days
                        .map((d) => WEEKDAYS.find((w) => w.value === d.weekday)?.label)
                        .join(", ")}
                    </strong>{" "}
                    ({SHIFT_LABEL[mine.days[0].shift].toLowerCase()}), {mine.weeksObserved} veckor
                    som underlag.
                  </span>
                  <button
                    type="button"
                    onClick={() => useSuggestion(mine)}
                    className="rounded bg-(--color-accent) px-3 py-1 text-white"
                  >
                    Fyll i
                  </button>
                </div>
              )}

              {/* Osäkra dagar redovisas men fylls aldrig i. Ett tyst
                  felaktigt mönster lägger ut fel person på fel bil. */}
              {mine.uncertain.length > 0 && (
                <p className="mt-2 text-(--color-muted)">
                  Oregelbundet:{" "}
                  {mine.uncertain
                    .map(
                      (e) =>
                        `${WEEKDAYS.find((w) => w.value === e.weekday)?.label} ${
                          SHIFT_ICON[e.shift]
                        } ${e.weeksWorked} av ${e.weeksObserved} veckor`,
                    )
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--color-line) px-5 py-3">
          <span className="text-xs text-(--color-muted)">
            {days.length} pass per cykel
            {saved && <span className="ml-2 text-(--color-accent)">✓ {saved}</span>}
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-(--color-muted)">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => {
                  setOverwrite(e.target.checked);
                  setSaved(null);
                }}
              />
              även de som redan har ett mönster
            </label>
            <button
              type="button"
              disabled={targets.length === 0 || pending}
              title={
                overwrite
                  ? "Skriver om mönstret för hela bemanningen"
                  : "Lägger mönstret på dem som saknar ett — de som redan har ett rörs inte"
              }
              onClick={() =>
                startTransition(async () => {
                  const { applied } = await applyWorkPatternToMany({
                    employeeIds: targets,
                    cycleWeeks,
                    anchorDate,
                    weekStartsOn,
                    days,
                    boardSlug: data.board.slug,
                  });
                  setSaved(`lagt på ${applied} personer`);
                })
              }
              className="rounded border border-(--color-line) px-4 py-1.5 text-sm disabled:opacity-40"
            >
              Använd på {targets.length} {targets.length === 1 ? "person" : "personer"}
            </button>
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
                  setSaved("sparat");
                })
              }
              className="rounded bg-(--color-accent) px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Spara mönster
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
