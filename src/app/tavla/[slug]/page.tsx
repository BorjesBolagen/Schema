import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getBoardWeek } from "@/server/board-week";
import { fullDisplayName } from "@/lib/name";
import { dateRangeLabel, isoWeek, toIso, weeksInYear } from "@/lib/week";
import { WeekGrid } from "@/components/WeekGrid";
import { PersonGrid } from "@/components/PersonGrid";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ar?: string; vecka?: string; vy?: string }>;
}

/** Föregående och nästa vecka, med årsskiftet hanterat. */
function step(year: number, week: number, delta: number): { year: number; week: number } {
  let y = year;
  let w = week + delta;
  if (w < 1) {
    y -= 1;
    w = weeksInYear(y);
  } else if (w > weeksInYear(y)) {
    y += 1;
    w = 1;
  }
  return { year: y, week: w };
}

export default async function BoardPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const today = isoWeek(toIso(new Date()));
  const year = Number(sp.ar) || today.year;
  const week = Number(sp.vecka) || today.week;
  const view = sp.vy === "person" ? "person" : "resource";

  const data = await getBoardWeek(slug, year, week);
  if (!data) notFound();

  const db = getDb();
  const [employees, vehicles] = await Promise.all([
    db.select().from(schema.employee).orderBy(asc(schema.employee.firstName)),
    db.select().from(schema.vehicle).orderBy(asc(schema.vehicle.displayName)),
  ]);

  const prev = step(year, week, -1);
  const next = step(year, week, 1);
  const href = (o: { year: number; week: number; view?: string }) =>
    `/tavla/${slug}?ar=${o.year}&vecka=${o.week}&vy=${o.view ?? view}`;

  const doubleBooked = data.conflicts.filter((c) => c.kind === "double-booked").length;
  const absentPlanned = data.conflicts.filter((c) => c.kind === "absent").length;
  const unmanned = data.conflicts.filter((c) => c.kind === "unmanned").length;

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-(--color-muted) hover:underline no-print">
            ← Alla tavlor
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{data.board.name}</h1>
        </div>

        <div className="flex items-center gap-3 no-print">
          <Link href={href(prev)} className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm">
            ◀
          </Link>
          <span className="text-sm font-medium">
            Vecka {week} · {dateRangeLabel(data.dates)}
          </span>
          <Link href={href(next)} className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm">
            ▶
          </Link>

          <div className="ml-4 flex rounded border border-(--color-line) bg-white text-sm">
            <Link
              href={href({ year, week, view: "resource" })}
              className={`px-3 py-1 ${view === "resource" ? "bg-(--color-accent) text-white" : ""}`}
            >
              Bilar
            </Link>
            <Link
              href={href({ year, week, view: "person" })}
              className={`px-3 py-1 ${view === "person" ? "bg-(--color-accent) text-white" : ""}`}
            >
              Personer
            </Link>
          </div>
        </div>
      </div>

      {(doubleBooked > 0 || absentPlanned > 0) && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-(--color-warn)">
          {doubleBooked > 0 && <>⚠ {doubleBooked} dubbelbokning{doubleBooked === 1 ? "" : "ar"}. </>}
          {absentPlanned > 0 && <>⚠ {absentPlanned} inplanerad under frånvaro. </>}
          <span className="text-(--color-muted)">{unmanned} tomma pass.</span>
        </p>
      )}

      <div className="mt-5">
        {view === "person" ? (
          <PersonGrid data={data} />
        ) : (
          <WeekGrid
            data={data}
            employees={employees.map((e) => ({ id: e.id, name: fullDisplayName(e) }))}
            vehicles={vehicles.map((v) => ({ id: v.id, name: v.displayName }))}
          />
        )}
      </div>
    </main>
  );
}
