import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { requireBoardBySlug } from "@/server/access";
import { getVacationYear } from "@/server/vacation-year";
import { VacationYear } from "@/components/VacationYear";
import { isoWeek, toIso } from "@/lib/week";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ar?: string }>;
}

export default async function VacationPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const { slug } = await params;
  await requireBoardBySlug(user, slug);
  const { ar } = await searchParams;
  const year = Number(ar) || isoWeek(toIso(new Date())).year;

  const data = await getVacationYear(slug, year);
  if (!data) notFound();

  /* Vägen tillbaka till innevarande år, av samma skäl som "Denna vecka"
     på tavlan: fem steg framåt hade ingen återresa utom fem klick. */
  const nuvarandeÅr = new Date().getFullYear();

  return (
    <main className="mx-auto max-w-[1700px] px-6 py-8">
      {/* Samma ordning som tavlans sidhuvud: namnet först, det man rör
          oftast intill det, och uttagen tyst till höger bakom ett streck.
          Året och Excel såg tidigare lika viktiga ut, fast man byter år
          för att titta och exporterar sällan. */}
      <header className="no-print">
        <Link href={`/tavla/${slug}`} className="text-xs text-(--color-muted) hover:underline">
          ← {data.board.name}
        </Link>

        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-xl font-semibold">Semesterplanering</h1>

          <div className="flex items-center gap-1">
            <Link
              href={`/tavla/${slug}/semester?ar=${year - 1}`}
              aria-label="Föregående år"
              className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm hover:border-(--color-accent)"
            >
              ◀
            </Link>
            <span className="px-2 text-sm font-medium">{year}</span>
            <Link
              href={`/tavla/${slug}/semester?ar=${year + 1}`}
              aria-label="Nästa år"
              className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm hover:border-(--color-accent)"
            >
              ▶
            </Link>
            {year !== nuvarandeÅr && (
              <Link
                href={`/tavla/${slug}/semester?ar=${nuvarandeÅr}`}
                className="ml-2 text-xs text-(--color-accent) hover:underline"
              >
                I år
              </Link>
            )}
          </div>

          <div className="ml-auto flex items-center gap-4 border-l border-(--color-line) pl-4 text-sm">
            <a
              href={`/tavla/${slug}/export?ar=${year}&vy=semester`}
              className="text-(--color-muted) hover:text-(--color-ink) hover:underline"
            >
              Excel
            </a>
            <PrintButton
              label="Skriv ut"
              className="cursor-pointer text-(--color-muted) hover:text-(--color-ink) hover:underline"
            />
          </div>
        </div>
      </header>

      {data.rows.length === 0 ? (
        <p className="mt-6 rounded border border-(--color-line) bg-white p-6 text-sm text-(--color-muted)">
          Ingen bemanning vald för tavlan ännu. Välj personal i veckovyn först.
        </p>
      ) : (
        <div className="mt-5">
          <VacationYear data={data} />
        </div>
      )}
    </main>
  );
}
