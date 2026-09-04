import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { requireBoardBySlug } from "@/server/access";
import { getVacationYear } from "@/server/vacation-year";
import { VacationYear } from "@/components/VacationYear";
import { isoWeek, toIso } from "@/lib/week";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** Samma konturform som tavlans uttag — se tavla/[slug]/page.tsx. */
const SEKUNDÄR =
  "flex h-[38px] items-center rounded-[9px] border border-(--color-field-line) bg-white px-3.5 font-semibold text-(--color-label) transition hover:border-(--color-dim)";

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
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">Semesterplanering</h1>

          {/* Samma reglage som veckoväxlingen på tavlan — det är samma
              sorts rörelse, bara ett annat steg i tiden. */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 rounded-[10px] border border-(--color-line) bg-(--color-chip) p-[3px]">
              <Link
                href={`/tavla/${slug}/semester?ar=${year - 1}`}
                aria-label="Föregående år"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-xs text-(--color-label) transition hover:bg-white"
              >
                ◀
              </Link>
              <span className="px-3 text-sm font-semibold tabular-nums">{year}</span>
              <Link
                href={`/tavla/${slug}/semester?ar=${year + 1}`}
                aria-label="Nästa år"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-xs text-(--color-label) transition hover:bg-white"
              >
                ▶
              </Link>
            </div>
            {year !== nuvarandeÅr && (
              <Link
                href={`/tavla/${slug}/semester?ar=${nuvarandeÅr}`}
                className="text-xs text-(--color-accent) hover:underline"
              >
                I år
              </Link>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2.5 text-sm">
            <a href={`/tavla/${slug}/export?ar=${year}&vy=semester`} className={SEKUNDÄR}>
              Excel
            </a>
            <PrintButton label="Skriv ut" className={`cursor-pointer ${SEKUNDÄR}`} />
          </div>
        </div>
      </header>

      {data.rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-(--color-line) bg-white p-6 text-sm text-(--color-muted)">
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
