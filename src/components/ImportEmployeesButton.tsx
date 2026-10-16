"use client";

import { useState, useTransition } from "react";
import { importNewEmployeesAction } from "@/app/transpa-actions";
import type { ImportNewResult, NewEmployee } from "@/server/transpa-sync";

/**
 * Hämtar nya personer från TransPA till personalregistret.
 *
 * Kvittot räknar upp vilka som kom in, med namn — "3 nya" säger inte om
 * det var den man väntade på.
 */
export function ImportEmployeesButton({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<ImportNewResult | null>(null);
  const [pending, startTransition] = useTransition();

  const label = (p: NewEmployee) =>
    `${p.name}${p.employeeNumber ? ` (${p.employeeNumber})` : ""}`;

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        disabled={disabled || pending}
        title={disabled ? "TransPA är inte kopplat i den här instansen." : undefined}
        onClick={() => startTransition(async () => setResult(await importNewEmployeesAction()))}
        className="rounded border border-(--color-line) bg-white px-4 py-2 text-sm font-medium text-(--color-ink) hover:border-(--color-ink) disabled:opacity-50"
      >
        {pending ? "Hämtar…" : "Hämta nya från TransPA"}
      </button>

      {result && (
        <div role="status" className="mt-2 max-w-[48ch] text-right text-xs">
          {result.errors.map((e) => (
            <p key={e} className="text-(--color-danger)">
              {e}
            </p>
          ))}
          {result.added.length === 0 && result.linked.length === 0 ? (
            result.ok && <p className="text-(--color-muted)">Inga nya personer i TransPA.</p>
          ) : (
            <>
              {result.added.length > 0 && (
                <p>
                  <span className="font-medium">
                    {result.added.length} {result.added.length === 1 ? "ny" : "nya"}:
                  </span>{" "}
                  <span className="text-(--color-muted)">{result.added.map(label).join(", ")}</span>
                </p>
              )}
              {result.linked.length > 0 && (
                <p>
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
