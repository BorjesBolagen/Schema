import Link from "next/link";
import { requireUser } from "@/server/auth";
import { editableBoardIds, visibleBoards } from "@/server/access";
import { TEMPLATE_LABELS } from "@/server/boards";
import { dateRangeLabel, isoWeek, toIso, weekDates } from "@/lib/week";
import { boardOverviews, lastSync } from "@/server/board-overview";
import { antal } from "@/lib/plural";
import { NewBoardForm } from "@/components/NewBoardForm";
import { RemoveBoardButton } from "@/components/RemoveBoardButton";
import { SchemaOutOfDate } from "@/components/SchemaOutOfDate";
import { schemaStatusFor } from "@/server/schema-guard";

export const dynamic = "force-dynamic";

/**
 * Ett tal med sin etikett.
 *
 * Talet först och stort, ordet efter och litet: listan läses genom att
 * jämföra siffror mellan tavlor, inte genom att läsa meningar.
 */
function Tal({
  värde,
  etikett,
  stark = false,
  ton,
}: {
  värde: number;
  etikett: string;
  stark?: boolean;
  ton?: "varning";
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span
        className={`text-sm ${
          ton === "varning"
            ? "font-semibold text-(--color-warn)"
            : stark
              ? "font-semibold text-(--color-ink)"
              : "text-(--color-ink)"
        }`}
      >
        {värde}
      </span>
      <span className={ton === "varning" ? "text-(--color-warn)" : "text-(--color-muted)"}>
        {etikett}
      </span>
    </span>
  );
}

/**
 * "i dag", "i går", "för 3 dagar sedan".
 *
 * Ett klockslag säger inte om uppgifterna är färska utan att man först
 * räknar ut vad dagens datum är. Den exakta tidpunkten finns kvar som
 * title för den som behöver den.
 */
function relativTid(när: Date): string {
  const dygn = Math.floor((Date.now() - när.getTime()) / 86_400_000);
  if (dygn <= 0) return "i dag";
  if (dygn === 1) return "i går";
  if (dygn < 30) return `för ${antal(dygn, "dag", "dagar")} sedan`;
  return när.toISOString().slice(0, 10);
}


export default async function Home() {
  const user = await requireUser();

  /* Ligger databasen efter koden ska sidan säga det, inte krascha med
     en stackspårning som inte nämner uppsättningsfilen. Kontrollen
     kostar ingenting när allt fungerar — den frågar först när något
     redan gått fel. */
  let boards: Awaited<ReturnType<typeof visibleBoards>>;
  try {
    boards = await visibleBoards(user);
  } catch (error) {
    const status = await schemaStatusFor(error);
    if (status) return <SchemaOutOfDate status={status} />;
    throw error;
  }

  /* Vilka tavlor som får ändras, hämtat en gång i stället för en fråga
     per kort. Avgör om bort-knappen ritas — en läsare ska inte se en
     knapp som servern ändå vägrar. */
  const fårÄndra = await editableBoardIds(user);
  const ändringsbar = (id: string) => fårÄndra === "alla" || fårÄndra.has(id);

  const now = isoWeek(toIso(new Date()));

  /* Veckans läge per tavla. Ett anrop för alla, inte ett per tavla — och
     ett fel här får inte fälla sidan: översikten är en bonus, listan är
     poängen. */
  const översikt = await boardOverviews(boards, now.year, now.week).catch(() => new Map());
  const senastSynk = await lastSync().catch(() => null);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Tavlor</h1>
        <nav className="flex gap-4 text-sm">
          {/* Grunddata är underlaget tavlorna byggs av, inte
              administration av appen — planeraren behöver det. */}
          <Link href="/grunddata" className="text-(--color-accent) hover:underline">
            Grunddata
          </Link>
          {/* Kopplingen till TransPA och databasen är driftsfrågor.
              De hör till den som förvaltar appen, inte till den som
              lägger scheman i den. */}
          {user.role === "admin" && (
            <>
              <Link href="/transpa" className="text-(--color-accent) hover:underline">
                TransPA-anslutning
              </Link>
              <Link href="/db-health" className="text-(--color-accent) hover:underline">
                Databaskoppling
              </Link>
            </>
          )}
        </nav>
      </div>
      <p className="mt-2 text-sm text-(--color-muted)">
        Vecka {now.week} · {dateRangeLabel(weekDates(now.year, now.week, 1, [0, 1, 2, 3, 4, 5, 6]))}
        {senastSynk && (
          <>
            {" · "}
            <span title={senastSynk.toISOString()}>
              hämtat från TransPA {relativTid(senastSynk)}
            </span>
          </>
        )}
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
                className="rounded border border-(--color-line) bg-white transition hover:border-(--color-accent)"
              >
                <Link
                  href={`/tavla/${b.slug}?ar=${now.year}&vecka=${now.week}`}
                  className="block px-5 pt-4"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-xs text-(--color-muted)">
                      {antal(b.visibleWeekdays.length, "dag", "dagar")} · start{" "}
                      {b.weekStartsOn === 0 ? "söndag" : "måndag"} ·{" "}
                      {b.visibleShifts.length > 1 ? "dag och natt" : "bara dag"}
                    </span>
                    {/* Kortet är en länk, och det ska synas utan att man
                        först måste föra musen över det. */}
                    <span aria-hidden className="ml-auto text-(--color-muted)">
                      →
                    </span>
                  </span>

                  {/* Veckans läge, inte bara ett namn att klicka på.
                      Fyra tal som går att räkna i databasen utan att
                      tolka något — se board-overview.ts för varför "ej
                      utlagda" inte står här. */}
                  <span className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <Tal
                      värde={översikt.get(b.id)?.assignments ?? 0}
                      etikett="utlagda pass"
                      stark
                    />
                    <Tal värde={översikt.get(b.id)?.crew ?? 0} etikett="i bemanningen" />
                    <Tal värde={översikt.get(b.id)?.rows ?? 0} etikett="rader" />
                    {(översikt.get(b.id)?.absent ?? 0) > 0 && (
                      <Tal
                        värde={översikt.get(b.id)!.absent}
                        etikett="frånvarande"
                        ton="varning"
                      />
                    )}
                  </span>
                </Link>

                <div className="mt-3 flex items-center gap-4 border-t border-(--color-line) px-5 py-2 text-sm">
                  <Link
                    href={`/tavla/${b.slug}/semester?ar=${now.year}`}
                    className="text-(--color-accent) hover:underline"
                  >
                    Semester
                  </Link>
                  {/* Listan visar bara tavlor man har tillgång till, och
                      servern prövar ändringsrätt på just den tavlan. Den
                      som byggt en tavla ska få riva den igen. */}
                  {ändringsbar(b.id) && (
                    <span className="ml-auto">
                      <RemoveBoardButton boardId={b.id} boardName={b.name} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <NewBoardForm templates={TEMPLATE_LABELS} />
        </>
      )}
    </main>
  );
}
