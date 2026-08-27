"use client";

import { useState, useTransition } from "react";
import { clearWeek, weekClearPreview, type WeekClearFacts } from "@/app/actions";
import { dateRangeLabel } from "@/lib/week";

/**
 * Tömmer veckan på pass.
 *
 * I två steg, som borttagningen av en tavla, och steg två säger vad som
 * faktiskt försvinner. Skillnaden mot den knappen är att det mesta här
 * går att få tillbaka: bemanningen och bas-schemat står kvar, så ett
 * tryck på "Fyll veckan" lägger ut de genererade passen igen.
 *
 * Handpålagda pass gör det inte. De räknas därför för sig — det är den
 * siffran som avgör om man ska tveka.
 */
export function ClearWeekButton({
  boardSlug,
  year,
  week,
}: {
  boardSlug: string;
  year: number;
  week: number;
}) {
  const [facts, setFacts] = useState<WeekClearFacts | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = () =>
    startTransition(async () => {
      setRemoved(null);
      setFacts(await weekClearPreview({ boardSlug, year, week }));
    });

  if (!facts) {
    return (
      <>
        <button
          type="button"
          onClick={ask}
          disabled={pending}
          className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          title="Tar bort veckans utlagda pass på den här tavlan"
        >
          Rensa veckan
        </button>
        {removed !== null && (
          <span className="text-xs text-(--color-muted)">
            {removed === 0 ? "Veckan var redan tom" : `${removed} pass borttagna`}
          </span>
        )}
      </>
    );
  }

  /* Ingenting att ta bort är inget att bekräfta. */
  if (facts.assignments === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setFacts(null)}
          className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm"
        >
          Rensa veckan
        </button>
        <span className="text-xs text-(--color-muted)">Veckan är redan tom</span>
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-xs text-(--color-danger)">
        Tar bort {facts.assignments} pass{" "}
        {facts.manual > 0 && (
          <>
            , varav <strong>{facts.manual} ändrade för hand</strong>
          </>
        )}{" "}
        ({dateRangeLabel([facts.from, facts.to])}).{" "}
        {facts.manual > 0
          ? "Handpålagda pass kommer inte tillbaka med Fyll veckan."
          : "Går att lägga ut igen med Fyll veckan."}
      </span>
      <button
        type="button"
        onClick={() => setFacts(null)}
        className="text-(--color-muted) hover:underline"
      >
        Avbryt
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await clearWeek({ boardSlug, year, week });
            setRemoved(result.removed);
            setFacts(null);
          })
        }
        className="rounded bg-(--color-danger) px-3 py-1 text-white disabled:opacity-50"
      >
        {pending ? "Rensar …" : "Rensa veckan"}
      </button>
    </div>
  );
}
