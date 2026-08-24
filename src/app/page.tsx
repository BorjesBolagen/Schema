import Link from "next/link";
import { requireUser } from "@/server/auth";
import { visibleBoards } from "@/server/access";
import { TEMPLATE_LABELS } from "@/server/boards";
import { isoWeek, toIso } from "@/lib/week";
import { NewBoardForm } from "@/components/NewBoardForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const boards = await visibleBoards(user);
  const now = isoWeek(toIso(new Date()));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Schema</h1>
        {user.role === "admin" && (
          <nav className="flex gap-4 text-sm">
            <Link href="/grunddata" className="text-(--color-accent) hover:underline">
              Grunddata
            </Link>
            <Link href="/transpa" className="text-(--color-accent) hover:underline">
              TransPA-anslutning
            </Link>
            <Link href="/db-health" className="text-(--color-accent) hover:underline">
              Databaskoppling
            </Link>
          </nav>
        )}
      </div>
      <p className="mt-2 text-sm text-(--color-muted)">
        Välj en tavla. Varje tavla har egen layout, egna rader och egna veckodagar.
      </p>

      {boards.length === 0 ? (
        <>
          <p className="mt-8 rounded border border-(--color-line) bg-white p-6 text-sm">
            {user.role === "admin"
              ? "Inga tavlor ännu. Skapa den första nedan."
              : "Du har inte fått tillgång till någon tavla. Skapa en egen, eller be en administratör lägga till dig på en."}
          </p>
          <NewBoardForm templates={TEMPLATE_LABELS} startOpen />
        </>
      ) : (
        <>
          <ul className="mt-8 space-y-3">
            {boards.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-4 rounded border border-(--color-line) bg-white px-5 py-4"
              >
                <Link
                  href={`/tavla/${b.slug}?ar=${now.year}&vecka=${now.week}`}
                  className="flex-1 hover:underline"
                >
                  <span className="font-medium">{b.name}</span>
                  <span className="ml-3 text-xs text-(--color-muted)">
                    {b.visibleWeekdays.length} dagar · start{" "}
                    {b.weekStartsOn === 0 ? "söndag" : "måndag"} ·{" "}
                    {b.visibleShifts.length > 1 ? "dag och natt" : "bara dag"}
                  </span>
                </Link>
                <Link
                  href={`/tavla/${b.slug}/semester?ar=${now.year}`}
                  className="text-sm text-(--color-accent) hover:underline"
                >
                  Semester
                </Link>
              </li>
            ))}
          </ul>
          <NewBoardForm templates={TEMPLATE_LABELS} />
        </>
      )}
    </main>
  );
}
