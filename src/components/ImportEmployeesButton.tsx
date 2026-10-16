"use client";

import { useState, useTransition } from "react";
import { importNewEmployeesAction } from "@/app/transpa-actions";
import type { ImportNewResult, NewEmployee } from "@/server/transpa-sync";

/**
 * Hämtar nya personer från TransPA till personalregistret.
 *
 * Ligger i startsidans verktygsrad bredvid Grunddata, så kvittot öppnas
 * som en ruta under knappen i stället för att skjuta ned tavlorna. Det
 * räknar upp vilka som kom in, med namn — "3 nya" säger inte om det var
 * den man väntade på.
 */
export function ImportEmployeesButton({
  disabled,
  className,
}: {
  disabled: boolean;
  className: string;
}) {
  const [result, setResult] = useState<ImportNewResult | null>(null);
  const [pending, startTransition] = useTransition();

  const label = (p: NewEmployee) =>
    `${p.name}${p.employeeNumber ? ` (${p.employeeNumber})` : ""}`;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || pending}
        title={disabled ? "TransPA är inte kopplat i den här instansen." : undefined}
        onClick={() =>
          startTransition(async () => setResult(await importNewEmployeesAction()))
        }
        className={`${className} disabled:opacity-50`}
      >
        {pending ? "Hämtar…" : "Hämta nya personer"}
      </button>

      {result && (
        <div
          role="status"
          className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-(--color-line) bg-white p-4 text-[13px] shadow-[0_12px_26px_-16px_rgba(34,36,42,.35)]"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-semibold">Från TransPA</span>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="Stäng"
              className="text-(--color-muted) hover:text-(--color-ink)"
            >
              ✕
            </button>
          </div>
          {result.errors.map((e) => (
            <p key={e} className="mt-2 text-(--color-danger)">
              {e}
            </p>
          ))}
          {result.added.length === 0 && result.linked.length === 0 ? (
            result.ok && <p className="mt-2 text-(--color-muted)">Inga nya personer i TransPA.</p>
          ) : (
            <>
              {result.added.length > 0 && (
                <p className="mt-2">
                  <span className="font-medium">
                    {result.added.length} {result.added.length === 1 ? "ny" : "nya"}:
                  </span>{" "}
                  <span className="text-(--color-muted)">{result.added.map(label).join(", ")}</span>
                </p>
              )}
              {result.linked.length > 0 && (
                <p className="mt-2">
                  <span className="font-medium">Kopplade till TransPA:</span>{" "}
                  <span className="text-(--color-muted)">{result.linked.map(label).join(", ")}</span>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
