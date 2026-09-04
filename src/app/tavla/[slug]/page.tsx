import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/server/auth";
import { canEditBoard, requireBoardBySlug } from "@/server/access";
import { getBoardWeek } from "@/server/board-week";
import { fullDisplayName } from "@/lib/name";
import { dateRangeLabel, isoWeek, toIso, weeksInYear } from "@/lib/week";
import { BoardWorkspace } from "@/components/BoardWorkspace";
import { PersonGrid } from "@/components/PersonGrid";
import { antal } from "@/lib/plural";
import { PrintButton } from "@/components/PrintButton";
import { SchemaOutOfDate } from "@/components/SchemaOutOfDate";
import { schemaStatusFor } from "@/server/schema-guard";

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
  const user = await requireUser();
  const { slug } = await params;
  const sp = await searchParams;
  const today = isoWeek(toIso(new Date()));
  const year = Number(sp.ar) || today.year;
  const week = Number(sp.vecka) || today.week;
  const view = sp.vy === "person" ? "person" : "resource";

  /* Både behörighetskontrollen och hämtningen läser tabeller som kan
     sakna en kolumn när koden är utrullad före migrationen — den första
     föll redan på att slå upp tavlan. Ligger databasen efter ska sidan
     säga det i stället för att krascha.

     notFound() kastar också, men schemaStatusFor svarar null på allt
     som inte är ett schemafel, och då kastas det vidare orört. */
  let data: Awaited<ReturnType<typeof getBoardWeek>>;
  let fårÄndra = false;
  try {
    const board = await requireBoardBySlug(user, slug);
    fårÄndra = await canEditBoard(user, board.id);
    data = await getBoardWeek(slug, year, week);
  } catch (error) {
    const status = await schemaStatusFor(error);
    if (status) return <SchemaOutOfDate status={status} />;
    throw error;
  }
  if (!data) notFound();

  // Personalväljarens lista kommer med getBoardWeek — samlingsfrågan
  // har redan hämtat personal och stationsorter.
  const allEmployees = data.pickerEmployees;

  const prev = step(year, week, -1);
  const next = step(year, week, 1);
  const href = (o: { year: number; week: number; view?: string }) =>
    `/tavla/${slug}?ar=${o.year}&vecka=${o.week}&vy=${o.view ?? view}`;

  /* Veckan som pågår nu, för vägen tillbaka. Räknas i serverns tid,
     vilket duger: gränsen går vid midnatt mellan söndag och måndag, och
     ingen planerar då. */
  const nu = isoWeek(toIso(new Date()));
  const ärDennaVecka = nu.year === year && nu.week === week;

  const doubleBooked = data.conflicts.filter((c) => c.kind === "double-booked").length;
  const absentPlanned = data.conflicts.filter((c) => c.kind === "absent").length;
  const unmanned = data.conflicts.filter((c) => c.kind === "unmanned").length;
  const wrongShift = data.conflicts.filter((c) => c.kind === "shift-mismatch").length;
  const unplacedPeople = new Set(
    data.crew.filter((c) => c.unplaced.length > 0).map((c) => c.employeeId),
  ).size;

  /* Bara det som faktiskt är fel. Antalet tomma pass hörde inte hit:
     det säger hur långt veckan kommit, inte att något gått sönder. */
  const problem = [
    doubleBooked > 0 && `${antal(doubleBooked, "dubbelbokning", "dubbelbokningar")}.`,
    absentPlanned > 0 && `${absentPlanned} inplanerad under frånvaro.`,
    /* Fel skift är ingen krock — passet finns, det står bara på fel
       rad. Men det är den vanligaste feltypen när ett schema förs över
       för hand. */
    wrongShift > 0 &&
      `${wrongShift} står på fel skift mot TransPA` +
        (wrongShift === 1 ? " (utlagd dag, planerad natt eller tvärtom)." : "."),
    unplacedPeople > 0 &&
      `${antal(unplacedPeople, "person", "personer")} jobbar men saknar bil.`,
  ].filter((x): x is string => typeof x === "string");

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8">
      {/*
        Sidhuvudet, ordnat efter hur ofta man rör sakerna.

        Allt låg förut i en rad med samma vikt: veckoväxlingen,
        vyvalet, semestervyn och två exporter, alla som lika stora
        vita knappar. Excel såg lika viktig ut som att byta vecka,
        fast man byter vecka varje gång och exporterar sällan. Och det
        var fyra olika sorters sak — flytta i tiden, byta vy, gå till en
        annan sida, ladda ned en fil — utan något som skilde dem åt.

        Nu: identiteten först, veckan som det tydligaste reglaget intill
        namnet, och det som görs sällan tyst och samlat till höger.
      */}
      <header className="no-print">
        <Link href="/" className="text-xs text-(--color-muted) hover:underline">
          ← Alla tavlor
        </Link>

        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-xl font-semibold">{data.board.name}</h1>

          {/* Veckan. Det man rör oftast, närmast namnet. */}
          <div className="flex items-center gap-1">
            <Link
              href={href(prev)}
              aria-label="Föregående vecka"
              className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm hover:border-(--color-accent)"
            >
              ◀
            </Link>
            <span className="px-2 text-sm font-medium whitespace-nowrap">
              Vecka {week} <span className="text-(--color-muted)">· {dateRangeLabel(data.dates)}</span>
            </span>
            <Link
              href={href(next)}
              aria-label="Nästa vecka"
              className="rounded border border-(--color-line) bg-white px-2 py-1 text-sm hover:border-(--color-accent)"
            >
              ▶
            </Link>
            {/* Vägen tillbaka. Fem steg framåt hade ingen återresa utom
                fem klick bakåt — och visas den alltid säger den
                ingenting, för då är man oftast redan där. */}
            {!ärDennaVecka && (
              <Link
                href={href({ ...nu, view })}
                className="ml-2 text-xs text-(--color-accent) hover:underline"
              >
                Denna vecka
              </Link>
            )}
          </div>

          <div className="flex overflow-hidden rounded border border-(--color-line) bg-white text-sm">
            <Link
              href={href({ year, week, view: "resource" })}
              className={`px-3 py-1 ${view === "resource" ? "bg-(--color-primary) text-white" : "hover:bg-gray-50"}`}
            >
              Bilar
            </Link>
            <Link
              href={href({ year, week, view: "person" })}
              className={`px-3 py-1 ${view === "person" ? "bg-(--color-primary) text-white" : "hover:bg-gray-50"}`}
            >
              Personer
            </Link>
          </div>

          {/* Det som görs sällan: en annan vy och två uttag. Tyst, och
              skilt från reglagen med ett streck i stället för att stå
              som ännu tre likadana knappar. */}
          <div className="ml-auto flex items-center gap-4 border-l border-(--color-line) pl-4 text-sm">
            <Link
              href={`/tavla/${slug}/semester?ar=${year}`}
              className="text-(--color-accent) hover:underline"
            >
              Semester
            </Link>
            <a
              href={`/tavla/${slug}/export?ar=${year}&vecka=${week}&vy=${view}`}
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

      {/* Ett problem per punkt, och varningstecknet en gång.
          Allt låg tidigare i en enda mening med ett ⚠ framför varje
          led, och sist i samma gula ruta stod antalet tomma pass — som
          inte är ett problem alls utan hur långt veckan kommit. Räknat
          med bland varningarna såg en halvfylld vecka ut som en trasig. */}
      {problem.length > 0 && (
        <div className="mt-4 flex w-fit max-w-full items-start gap-2 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-(--color-warn)">
          <span aria-hidden className="select-none leading-5">
            ⚠
          </span>
          <ul className="space-y-0.5">
            {problem.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Hur långt veckan kommit, inte ett fel. Egen rad, utan ruta och
          utan varningsfärg — den som ser den ska läsa den som en
          mätare, inte som något att åtgärda. */}
      {unmanned > 0 && (
        <p className="mt-2 text-xs text-(--color-muted)">
          {antal(unmanned, "tomt pass", "tomma pass")} kvar den här veckan.
        </p>
      )}

      {/* canDelete följer ändringsrätten på tavlan, inte rollen: den
          som byggt en tavla ska få riva den igen, och den som bara får
          läsa ska inte se knappen alls. */}
      <div className="mt-5">
        {view === "person" ? (
          <PersonGrid data={data} />
        ) : (
          <BoardWorkspace data={data} allEmployees={allEmployees} canDelete={fårÄndra} />
        )}
      </div>
    </main>
  );
}
