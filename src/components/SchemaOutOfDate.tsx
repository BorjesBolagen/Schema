import Link from "next/link";
import type { SchemaStatus } from "@/server/schema-guard";

/**
 * Sidan som visas när databasen ligger efter koden.
 *
 * Alternativet är en stackspårning med `column "cycle_length" does not
 * exist`, vilket är sant men obrukbart: ingenting i det säger att svaret
 * är att klistra in en fil i Supabase. Det här säger det, och namnger de
 * migrationer som fattas när de går att räkna upp.
 */
export function SchemaOutOfDate({ status }: { status: SchemaStatus }) {
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
        <li>Ladda om den här sidan.</li>
      </ol>

      <p className="mt-4 max-w-[62ch] text-xs text-(--color-muted)">
        Filen går att köra om: det som redan finns hoppas över, det som fattas läggs på. Du
        behöver inte veta hur långt databasen kommit.
      </p>

      {status.pending.length > 0 && (
        <div className="mt-6 rounded border border-(--color-line) bg-white p-4">
          <p className="text-xs text-(--color-muted)">Migrationer som inte är körda:</p>
          <ul className="mt-1 font-mono text-xs">
            {status.pending.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-8 text-xs text-(--color-muted)">
        <Link href="/db-health" className="hover:underline">
          Databaskoppling
        </Link>{" "}
        visar samma sak, tillsammans med hur snabbt databasen svarar.
      </p>
    </main>
  );
}
