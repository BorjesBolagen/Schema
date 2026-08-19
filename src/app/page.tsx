import Link from "next/link";
import { listBoards } from "@/server/board-week";
import { isoWeek, toIso } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function Home() {
  const boards = await listBoards();
  const now = isoWeek(toIso(new Date()));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Schema</h1>
      <p className="mt-2 text-sm text-(--color-muted)">
        Välj en tavla. Varje tavla har egen layout, egna rader och egna veckodagar.
      </p>

      {boards.length === 0 ? (
        <p className="mt-8 rounded border border-(--color-line) bg-white p-6 text-sm">
          Inga tavlor ännu. Kör importen:{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">
            npm run import -- --file &lt;Schema.xlsx&gt; --db ./.pgdata
          </code>
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                href={`/tavla/${b.slug}?ar=${now.year}&vecka=${now.week}`}
                className="block rounded border border-(--color-line) bg-white px-5 py-4 hover:border-(--color-accent)"
              >
                <span className="font-medium">{b.name}</span>
                <span className="ml-3 text-xs text-(--color-muted)">
                  {b.visibleWeekdays.length} dagar · start{" "}
                  {b.weekStartsOn === 0 ? "söndag" : "måndag"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
