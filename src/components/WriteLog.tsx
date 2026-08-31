import { recentWrites } from "@/server/shift-write";

/**
 * Skrivningarna till TransPA, senast först.
 *
 * Finns för att felen annars inte syns någonstans. sendShiftMove fångar
 * varje fel, sparar det och returnerar ett vänligt meddelande — vilket
 * betyder att ingenting hamnar i Vercels logg. Står svaret då inte här
 * heller blir "0 skickade, 1 misslyckades" allt planeraren får veta,
 * och nästa steg är att gissa.
 *
 * Kroppen visas i klartext, både den skickade och den mottagna. Det är
 * schemadata — tider och ett pass-id — inte något känsligt, och det är
 * exakt de fälten en felsökning handlar om.
 */
export async function WriteLog() {
  const rader = await recentWrites(20);

  if (rader.length === 0) {
    return (
      <p className="text-xs text-(--color-muted)">
        Ingenting har skickats till TransPA än. Raden skrivs här så fort någon
        trycker på
        <em> Skicka till TransPA</em>, oavsett om det gick bra eller inte.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {rader.map((r) => (
        <li
          key={r.id}
          className={`rounded border p-3 text-xs ${
            r.status === "ok"
              ? "border-(--color-line) bg-white"
              : "border-red-300 bg-red-50"
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span
              className={`font-medium ${
                r.status === "ok" ? "text-green-800" : "text-(--color-danger)"
              }`}
            >
              {r.status === "ok" ? "Skickat" : "Misslyckades"}
            </span>
            <span className="text-sm">{r.summary}</span>
            <span className="ml-auto text-(--color-muted)">
              {r.createdAt instanceof Date
                ? r.createdAt.toISOString().slice(0, 16).replace("T", " ")
                : ""}
            </span>
          </div>
          <div className="mt-1 font-mono break-all text-(--color-muted)">
            {r.method} {r.path}
            {r.responseStatus !== null && ` → HTTP ${r.responseStatus}`}
          </div>
          {r.responseBody && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">
              {r.responseBody}
            </pre>
          )}
          {r.requestBody && (
            <details className="mt-1">
              <summary className="cursor-pointer text-(--color-muted)">
                Skickad kropp
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">
                {r.requestBody}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
