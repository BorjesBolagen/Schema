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

  return (
    <main className="mx-auto max-w-[1700px] px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Link
            href={`/tavla/${slug}`}
            className="text-xs text-(--color-muted) hover:underline no-print"
          >
            ← {data.board.name}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Semesterplanering {year}</h1>
        </div>

        <div className="flex items-center gap-3 no-print">
          <Link
            href={`/tavla/${slug}/semester?ar=${year - 1}`}
            className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm"
          >
            ◀
          </Link>
          <span className="text-sm font-medium">{year}</span>
          <Link
            href={`/tavla/${slug}/semester?ar=${year + 1}`}
            className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm"
          >
            ▶
          </Link>
          <a
            href={`/tavla/${slug}/export?ar=${year}&vy=semester`}
            className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm"
          >
            Excel
          </a>
          <PrintButton />
        </div>
      </div>

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
