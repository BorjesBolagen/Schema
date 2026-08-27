"use client";

import { useState, useTransition } from "react";
import { lookupShiftsAction } from "@/app/transpa-actions";
import type { ShiftLookupResult } from "@/server/shift-lookup";

const field =
  "rounded border border-(--color-line) bg-white px-2 py-1.5 text-sm text-(--color-ink)";

const SHORT_DAY = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];

/** Veckodagen ur ett datum, utan att bygga ett Date i fel tidszon. */
function weekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return SHORT_DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Timmar och minuter, som ett schema läses. */
function duration(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Slå upp en persons pass i TransPA.
 *
 * Finns för att göra frågan konkret. Så länge svaret var "hämtningen
 * fungerar inte" gick bygget i cirklar; en person och ett datumintervall
 * ger i stället ett svar som går att handla på — och visar vad ett pass
 * faktiskt innehåller, inklusive de nästlade fälten som inte går att
 * gissa sig till.
 */
export function ShiftLookup({
  defaultPerson,
  defaultFrom,
  defaultTo,
}: {
  defaultPerson: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [person, setPerson] = useState(defaultPerson);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [result, setResult] = useState<ShiftLookupResult | null>(null);
  const [pending, startTransition] = useTransition();

  const look = () =>
    startTransition(async () => setResult(await lookupShiftsAction({ person, from, to })));

  return (
    <div className="rounded border border-(--color-line) bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-(--color-muted)">
          Person
          <input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            aria-label="Person"
            placeholder="TransPA-id eller anst.nr"
            className={`mt-1 block w-[22rem] max-w-full ${field}`}
          />
        </label>
        <label className="text-xs text-(--color-muted)">
          Från
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Från och med"
            className={`mt-1 block ${field}`}
          />
        </label>
        <label className="text-xs text-(--color-muted)">
          Till
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Till och med"
            className={`mt-1 block ${field}`}
          />
        </label>
        <button
          type="button"
          onClick={look}
          disabled={pending}
          className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Hämtar …" : "Hämta passen"}
        </button>
      </div>

      {result && !result.ok && (
        <p className="mt-3 rounded border border-(--color-danger) bg-red-50 p-3 text-sm text-(--color-danger)">
          {result.error}
          {result.url && (
            <span className="mt-1 block font-mono text-xs break-all opacity-80">{result.url}</span>
          )}
        </p>
      )}

      {result?.ok && (
        <div className="mt-4">
          <p className="text-sm">
            <strong>{result.who?.name}</strong>
            {result.who?.employeeNumber && (
              <span className="text-(--color-muted)"> · anst.nr {result.who.employeeNumber}</span>
            )}
            <span className="text-(--color-muted)">
              {" "}
              · {result.count} pass {from}–{to}
            </span>
          </p>
          <p className="mt-1 font-mono text-xs break-all text-(--color-muted)">{result.url}</p>

          {result.count === 0 ? (
            <p className="mt-3 text-sm text-(--color-warn)">
              Anropet lyckades men gav inga pass. Antingen har personen inga inlagda i perioden,
              eller så ligger de på ett annat bolag.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-(--color-muted) uppercase">
                    <th className="py-2 pr-4 font-medium">Datum</th>
                    <th className="py-2 pr-4 font-medium">Start</th>
                    <th className="py-2 pr-4 font-medium">Längd</th>
                    <th className="py-2 pr-4 font-medium">Tolkas som</th>
                    <th className="py-2 font-medium">Benämning</th>
                  </tr>
                </thead>
                <tbody>
                  {result.shifts?.map((s) => (
                    <tr key={s.id ?? s.startDateTime} className="border-t border-(--color-line)">
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {s.date ? `${weekday(s.date)} ${s.date}` : "—"}
                      </td>
                      <td className="py-1.5 pr-4 tabular-nums">{s.localTime ?? "—"}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{duration(s.workMinutes)}</td>
                      <td className="py-1.5 pr-4">
                        {s.shift === "night" ? "🌙 natt" : s.shift === "day" ? "☀️ dag" : "—"}
                        {s.isExtraShift && (
                          <span className="ml-2 text-xs text-(--color-warn)">extrapass</span>
                        )}
                      </td>
                      <td className="py-1.5 text-xs text-(--color-muted)">
                        {s.name ?? s.description ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Rådatan för första passet: partsOfDay och breaks är nästlade
              och går inte att beskriva utifrån namnet. Nästa steg beror
              på vad som faktiskt står där. */}
          {result.raw && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-(--color-muted)">
                Första passet, precis som API:t skickade det
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded border border-(--color-line) bg-gray-50 p-3 font-mono text-xs">
                {result.raw}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
