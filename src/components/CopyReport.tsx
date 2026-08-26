"use client";

import { useState } from "react";

/**
 * Kopierar hela diagnostiken som ren text.
 *
 * Finns för att rapporten ska gå att skicka vidare i sin helhet.
 * Fältnamnen ligger i egna element i tabellen, och en vanlig markering
 * i webbläsaren tar inte alltid med dem — då försvinner just det som
 * är mest värt att veta.
 */
export function CopyReport({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Klippbordet nekas i vissa lägen; markera texten i stället.
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 2500);
      }}
      className="rounded border border-(--color-line) px-3 py-1.5 text-sm hover:bg-white"
    >
      {done ? "Kopierad ✓" : "Kopiera rapporten som text"}
    </button>
  );
}
