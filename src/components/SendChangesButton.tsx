"use client";

import { useState, useTransition } from "react";
import {
  pendingChanges,
  sendPendingChanges,
  type PendingChanges,
} from "@/app/transpa-write-actions";
import { shortDayLabel } from "@/lib/week";

/**
 * Skickar veckans schemaändringar tillbaka till TransPA.
 *
 * Två steg, och steg två räknar upp varje ändring med namn och datum.
 * "Är du säker?" hade varit enklare och sämre: TransPA-tenanten är
 * produktionsmiljö, och den som trycker ska se exakt vad som lämnar
 * huset — inte behöva lita på att det är rätt.
 *
 * Personer som inte får skrivas till visas ändå, men gråtonade och med
 * skälet utskrivet. Att dölja dem hade sett ut som att de inte hade
 * några ändringar.
 */
export function SendChangesButton({
  boardSlug,
  year,
  week,
}: {
  boardSlug: string;
  year: number;
  week: number;
}) {
  const [changes, setChanges] = useState<PendingChanges | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: number; messages: string[] } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const ask = () =>
    startTransition(async () => {
      setResult(null);
      setChanges(await pendingChanges({ boardSlug, year, week }));
    });

  if (!changes) {
    return (
      <>
        <button
          type="button"
          onClick={ask}
          disabled={pending}
          className="rounded border border-(--color-warn) bg-white px-3 py-1.5 text-sm font-medium text-(--color-warn) disabled:opacity-50"
          title="Jämför tavlan med TransPA och skickar tillbaka det du ändrat"
        >
          {pending ? "Jämför …" : "4 · Skicka till TransPA"}
        </button>
        {result && (
          <span
            className={`text-xs ${result.failed > 0 ? "text-(--color-danger)" : "text-(--color-muted)"}`}
            title={result.messages.join("\n")}
          >
            {result.sent} skickade
            {result.failed > 0 && `, ${result.failed} misslyckades`}
          </span>
        )}
      </>
    );
  }

  const skrivbara = changes.moves.filter((m) => m.writable);

  return (
    <div className="w-full rounded border border-(--color-warn) bg-white p-3 text-sm">
      <p className="font-medium">Skicka till TransPA</p>

      {changes.moves.length === 0 ? (
        <p className="mt-1 text-(--color-muted)">
          Inga flyttade pass. Tavlan säger samma sak som TransPA.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {changes.moves.map((m) => (
            <li
              key={`${m.transpaId}-${m.to}`}
              className={m.writable ? "" : "text-(--color-muted)"}
            >
              <span className="font-medium">{m.name}</span>{" "}
              {m.shift === "night" ? "🌙" : "☀️"} {shortDayLabel(m.from)} →{" "}
              {shortDayLabel(m.to)}
              {!m.writable && (
                <span className="ml-2 text-xs">
                  — skickas inte, bara testpersonen får skrivas till än
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {(changes.added > 0 || changes.removed > 0) && (
        <p className="mt-2 max-w-[62ch] text-xs text-(--color-muted)">
          {changes.added > 0 && `${changes.added} pass står på tavlan utan motsvarighet i TransPA. `}
          {changes.removed > 0 && `${changes.removed} pass i TransPA står ingen på. `}
          Sådana skapas eller tas inte bort härifrån — bara flyttar skickas.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => setChanges(null)}
          className="text-(--color-muted) hover:underline"
        >
          Avbryt
        </button>
        <button
          type="button"
          disabled={pending || skrivbara.length === 0}
          onClick={() =>
            startTransition(async () => {
              setResult(await sendPendingChanges({ boardSlug, year, week }));
              setChanges(null);
            })
          }
          className="rounded bg-(--color-warn) px-3 py-1 text-white disabled:opacity-40"
        >
          {pending
            ? "Skickar …"
            : skrivbara.length === 0
              ? "Inget att skicka"
              : `Skicka ${skrivbara.length} ${skrivbara.length === 1 ? "ändring" : "ändringar"}`}
        </button>
      </div>
    </div>
  );
}
