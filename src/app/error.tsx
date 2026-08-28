"use client";

import { useEffect, useState } from "react";
import { schemaBehind } from "./schema-actions";

/**
 * Felgränsen — och framför allt vakten mot att koden är utrullad före
 * migrationen.
 *
 * Det har hänt två gånger, på två olika sidor, och båda gångerna fick
 * användaren en stackspårning som inte nämnde uppsättningsfilen. Att
 * vakta sida för sida räcker uppenbarligen inte: nästa gång är det en
 * tredje sida.
 *
 * Next döljer felmeddelandet i drift och lämnar bara en digest, så den
 * här gränsen kan inte läsa sig till orsaken. Den frågar servern i
 * stället, och frågar bara när något redan gått sönder.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const [pending, setPending] = useState<string[] | null>(null);

  useEffect(() => {
    schemaBehind()
      .then(setPending)
      .catch(() => setPending([]));
  }, []);

  if (pending === null) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-(--color-muted)">Något gick fel. Tar reda på vad …</p>
      </main>
    );
  }

  if (pending.length > 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Databasen behöver uppdateras</h1>
        <p className="mt-3 max-w-[62ch] text-sm">
          Appen är utrullad med ändringar som databasen inte har fått än. Inget är trasigt och
          ingenting har gått förlorat — det som fattas är att köra uppsättningsfilen.
        </p>
        <ol className="mt-6 max-w-[62ch] list-decimal space-y-2 pl-5 text-sm">
          <li>
            Öppna <strong>Supabase → SQL Editor</strong>.
          </li>
          <li>
            Klistra in hela innehållet i <code>docs/supabase-setup.sql</code> och kör.
          </li>
          <li>Ladda om sidan.</li>
        </ol>
        <div className="mt-6 rounded border border-(--color-line) bg-white p-4">
          <p className="text-xs text-(--color-muted)">Migrationer som inte är körda:</p>
          <ul className="mt-1 font-mono text-xs">
            {pending.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Något gick fel</h1>
      <p className="mt-3 max-w-[62ch] text-sm text-(--color-muted)">
        Databasen är i fas med koden, så det är något annat. Försök igen — står det kvar finns
        felet i serverloggen.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white"
      >
        Försök igen
      </button>
    </main>
  );
}
