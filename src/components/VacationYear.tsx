"use client";

import { useMemo, useState, useTransition } from "react";
import type { VacationYear as YearData } from "@/server/vacation-year";
import {
  ABSENCE_COLOR,
  ABSENCE_LABEL,
  ABSENCE_TYPES,
  type AbsenceType,
} from "@/lib/absence";
import { clearAbsenceWeek, setAbsenceWeeks } from "@/app/actions";
import { mondayOfWeek, parseIso } from "@/lib/week";

const MONTHS = ["jan", "feb", "mars", "april", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

/** Månadsrubrikerna, som spann över de veckor som börjar i månaden. */
function monthSpans(year: number, weeks: number[]) {
  const spans: Array<{ label: string; span: number }> = [];
  for (const w of weeks) {
    const month = parseIso(mondayOfWeek(year, w)).getUTCMonth();
    const last = spans[spans.length - 1];
    if (last && last.label === MONTHS[month]) last.span++;
    else spans.push({ label: MONTHS[month], span: 1 });
  }
  return spans;
}

/**
 * Semester- och frånvaroplanering för ett helt år.
 *
 * Dra över veckor för att markera. Bemanningsraden längst ned räknar hur
 * många som är kvar varje vecka och varnar under den nivå ni satt — det
 * som i Excel upptäcks först när en vecka visar sig omöjlig att bemanna.
 */
export function VacationYear({ data }: { data: YearData }) {
  const [type, setType] = useState<AbsenceType>("semester");
  const [status, setStatus] = useState<"approved" | "requested">("approved");
  const [minStaff, setMinStaff] = useState(Math.max(1, Math.ceil(data.crewSize * 0.5)));
  const [drag, setDrag] = useState<{ employeeId: string; from: number; to: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const selection = useMemo(() => {
    if (!drag) return null;
    const [a, b] = [drag.from, drag.to].sort((x, y) => x - y);
    return { employeeId: drag.employeeId, weeks: Array.from({ length: b - a + 1 }, (_, i) => a + i) };
  }, [drag]);

  /** Frånvaron som täcker en vecka, om någon. */
  const absenceAt = (row: YearData["rows"][number], week: number) =>
    row.absences.find((a) => a.weeks.includes(week));

  function commit() {
    if (!selection) return;
    const { employeeId, weeks } = selection;
    setDrag(null);

    const row = data.rows.find((r) => r.employeeId === employeeId);
    const allMarked = row && weeks.every((w) => absenceAt(row, w));

    startTransition(async () => {
      if (allMarked) {
        // Dra över redan markerade veckor tar bort dem igen.
        for (const week of weeks) {
          await clearAbsenceWeek({ employeeId, year: data.year, week, boardSlug: data.board.slug });
        }
      } else {
        await setAbsenceWeeks({
          employeeId,
          year: data.year,
          weeks,
          type,
          status,
          boardSlug: data.board.slug,
        });
      }
    });
  }

  return (
    <div onMouseUp={commit} onMouseLeave={() => drag && commit()}>
      <div className="mb-4 flex flex-wrap items-end gap-4 no-print">
        <label className="text-xs text-(--color-muted)">
          Typ
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AbsenceType)}
            className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          >
            {ABSENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ABSENCE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-(--color-muted)">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          >
            <option value="approved">Beviljad</option>
            <option value="requested">Önskemål</option>
          </select>
        </label>

        <label className="text-xs text-(--color-muted)">
          Varna under
          <input
            type="number"
            min={0}
            max={data.crewSize}
            value={minStaff}
            onChange={(e) => setMinStaff(Number(e.target.value))}
            className="mt-1 block w-20 rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          />
        </label>

        <p className="text-xs text-(--color-muted)">
          Dra över veckor för att markera. Dra över markerade veckor igen för att ta bort.
        </p>
      </div>

      <div className="grid-scroll rounded border border-(--color-line) bg-white">
        <table className="border-collapse text-xs select-none">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50" />
              {monthSpans(data.year, data.weeks).map((m, i) => (
                <th
                  key={i}
                  colSpan={m.span}
                  className="border-b border-l border-(--color-line) bg-gray-50 py-1 text-center text-[11px] font-normal text-(--color-muted)"
                >
                  {m.span > 1 ? m.label : ""}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-10 border-b border-(--color-line) bg-gray-50 px-3 py-2 text-left font-medium">
                Person
              </th>
              {data.weeks.map((w) => (
                <th
                  key={w}
                  className="w-6 border-b border-l border-(--color-line) bg-gray-50 py-2 text-center font-normal text-(--color-muted)"
                >
                  {w % 2 === 1 ? w : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.employeeId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-(--color-line) bg-white px-3 py-1 text-left font-normal whitespace-nowrap"
                >
                  {row.name}
                  {row.stationPlace && (
                    <span className="ml-2 text-(--color-muted)">{row.stationPlace}</span>
                  )}
                </th>
                {data.weeks.map((w) => {
                  const hit = absenceAt(row, w);
                  const inSelection =
                    selection?.employeeId === row.employeeId && selection.weeks.includes(w);
                  const colour = hit ? ABSENCE_COLOR[hit.type] : undefined;
                  return (
                    <td
                      key={w}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setDrag({ employeeId: row.employeeId, from: w, to: w });
                      }}
                      onMouseEnter={() =>
                        drag?.employeeId === row.employeeId && setDrag({ ...drag, to: w })
                      }
                      title={
                        hit
                          ? `${ABSENCE_LABEL[hit.type]} ${hit.fromDate} – ${hit.toDate}${
                              hit.status === "requested" ? " (önskemål)" : ""
                            }`
                          : `Vecka ${w}`
                      }
                      className={`h-6 w-6 cursor-pointer border-b border-l border-(--color-line) ${
                        inSelection ? "ring-2 ring-(--color-accent) ring-inset" : ""
                      }`}
                      style={
                        colour
                          ? {
                              backgroundColor: colour,
                              // Önskemål ritas rastrerat, beviljat heldraget.
                              opacity: hit!.status === "requested" ? 0.35 : 1,
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </tr>
            ))}

            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 border-t-2 border-(--color-line) bg-white px-3 py-1 text-left font-medium whitespace-nowrap"
              >
                Bemanning kvar
              </th>
              {data.weeks.map((w) => {
                const n = data.availablePerWeek[w] ?? 0;
                const low = n < minStaff;
                return (
                  <td
                    key={w}
                    className={`border-t-2 border-l border-(--color-line) text-center ${
                      low ? "bg-red-100 font-semibold text-(--color-danger)" : "text-(--color-muted)"
                    }`}
                    title={low ? `Vecka ${w}: bara ${n} kvar` : `Vecka ${w}: ${n} kvar`}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-(--color-muted)">
        {ABSENCE_TYPES.map((t) => (
          <li key={t} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: ABSENCE_COLOR[t] }}
            />
            {ABSENCE_LABEL[t]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-(--color-primary) opacity-35" />
          Önskemål
        </li>
      </ul>

      {pending && <p className="mt-2 text-xs text-(--color-muted)">Sparar…</p>}
    </div>
  );
}
