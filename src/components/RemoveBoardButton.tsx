"use client";

import { useState, useTransition } from "react";
import { boardRemovalPreview, removeBoard } from "@/app/basedata-actions";
import type { BoardRemovalFacts } from "@/server/boards";

/**
 * Tar bort en hel tavla, från listan där tavlorna syns.
 *
 * I två steg, och steg två visar vad som faktiskt försvinner. En tavla
 * bär rader, bemanning, bas-schema och veckor av utlagda pass, och
 * ingenting av det går att få tillbaka. Att räkna upp det innan är
 * skillnaden mellan ett medvetet beslut och ett felklick.
 *
 * Personalen rörs inte — den hör till registret, inte till tavlan.
 */
export function RemoveBoardButton({ boardId, boardName }: { boardId: string; boardName: string }) {
  const [facts, setFacts] = useState<BoardRemovalFacts | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = () => startTransition(async () => setFacts(await boardRemovalPreview(boardId)));

  if (!facts) {
    return (
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        aria-label={`Ta bort ${boardName}`}
        className="text-sm text-(--color-muted) hover:text-(--color-danger) hover:underline disabled:opacity-50"
      >
        Ta bort
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <span className="text-xs text-(--color-danger)">
        Tar bort {facts.rows} rader, {facts.crew} personer i bemanningen och {facts.assignments} pass.
        Går inte att ångra. Personalen finns kvar.
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
        onClick={() => startTransition(() => removeBoard(boardId))}
        disabled={pending}
        className="rounded bg-(--color-danger) px-3 py-1 text-white disabled:opacity-50"
      >
        {pending ? "Tar bort …" : "Ta bort tavlan"}
      </button>
    </div>
  );
}
