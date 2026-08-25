"use client";

import { useState, useTransition } from "react";
import { runTranspaSync } from "@/app/transpa-actions";
import type { SyncResult } from "@/server/transpa-sync";

export function SyncButton({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => startTransition(async () => setResult(await runTranspaSync()))}
        className="rounded bg-(--color-accent) px-4 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {pending ? "Synkar…" : "Synka nu"}
      </button>

      {result && (
        <table className="mt-3 border-collapse text-xs">
          <tbody>
            {result.results.map((r) => (
              <tr key={r.resource} className="border-t border-(--color-line)">
                <td className="py-1 pr-4 font-mono">{r.resource}</td>
                <td className="py-1 pr-4">
                  {r.skipped ? (
                    // Överhoppad är inte ett fel — resursen har inget scope.
                    <span className="text-(--color-muted)">{r.error}</span>
                  ) : r.error ? (
                    <span className="text-(--color-danger)">{r.error}</span>
                  ) : (
                    <span className="text-(--color-muted)">
                      {r.written} av {r.fetched} skrivna
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
