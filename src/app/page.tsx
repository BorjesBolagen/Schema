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

/** Samma konturform som tavlans uttag — se tavla/[slug]/page.tsx. */
const SEKUNDÄR =
  "flex h-[38px] items-center rounded-[9px] border border-(--color-field-line) bg-white px-3.5 font-semibold text-(--color-label) transition hover:border-(--color-dim)";

/**
 * Ett tal med sin etikett.
 *
 * Talet först och stort, ordet under och litet: korten läses genom att
 * jämföra siffror mellan tavlor, inte genom att läsa meningar. Stod
 * tidigare på en rad med ordet efter talet — det gick att läsa, men inte
 * att jämföra i sidled mellan tre kort.
 */
function Tal({
  värde,
  etikett,
  ton,
}: {
  värde: number;
  etikett: string;
  ton?: "varning" | "svag";
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={`text-[22px] leading-none font-semibold tabular-nums ${
          ton === "varning"
            ? "text-(--color-warn)"
            : ton === "svag"
              ? "text-(--color-dim)"
              : "text-(--color-ink)"
        }`}
      >
        {värde}
      </span>
      <span
        className={`text-[11px] font-medium tracking-[.06em] uppercase ${
          ton === "varning" ? "text-(--color-warn)" : "text-(--color-muted)"
        }`}
      >
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
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-[27px] font-semibold tracking-[-0.015em]">Tavlor</h1>
        <nav className="flex flex-wrap gap-2 text-sm">
          {/* Grunddata är underlaget tavlorna byggs av, inte
              administration av appen — planeraren behöver det. */}
          <Link href="/grunddata" className={SEKUNDÄR}>
            Grunddata
          </Link>
          {/* Kopplingen till TransPA och databasen är driftsfrågor.
              De hör till den som förvaltar appen, inte till den som
              lägger scheman i den. */}
          {user.role === "admin" && (
            <>
              <Link href="/transpa" className={SEKUNDÄR}>
                TransPA-anslutning
              </Link>
              <Link href="/db-health" className={SEKUNDÄR}>
                Databaskoppling
              </Link>
            </>
          )}
        </nav>
      </div>
      {/* Färskheten som ett eget märke, inte som ett led i en mening.
          Den säger om underlaget går att lita på, och det är en annan
          sorts upplysning än vilken vecka man tittar på. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-(--color-muted)">
        {senastSynk && (
          <span
            title={senastSynk.toISOString()}
            className="flex items-center gap-2 rounded-full border border-(--color-brand-line) bg-(--color-brand-wash) px-3 py-1 font-semibold text-(--color-brand-deep)"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-(--color-brand-amber)" />
            Hämtat från TransPA {relativTid(senastSynk)}
          </span>
        )}
        <span>
          Vecka {now.week} ·{" "}
          {dateRangeLabel(weekDates(now.year, now.week, 1, [0, 1, 2, 3, 4, 5, 6]))}
        </span>
      </div>

      {boards.length === 0 ? (
        <>
          <p className="mt-8 rounded-2xl border border-(--color-line) bg-white p-6 text-sm">
            {user.role === "admin"
              ? "Inga tavlor ännu. Skapa den första nedan."
              : "Du har inte fått tillgång till någon tavla. Skapa en egen, eller be en administratör lägga till dig på en."}
          </p>
          <NewBoardForm templates={TEMPLATE_LABELS} startOpen />
        </>
      ) : (
        <>
          {/* Kort i ett rutnät i stället för rader i en lista.
              Raderna var en meny med siffror efter: man läste dem uppifrån
              och ned, en tavla i taget. Korten går att jämföra i sidled —
              samma tre tal på samma plats i varje kort — vilket är hur
              man använder sidan: var behöver något göras i dag. */}
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {boards.map((b) => {
              const o = översikt.get(b.id);
              const tomt = (o?.assignments ?? 0) === 0;
              return (
                <li
                  key={b.id}
                  className="flex flex-col rounded-2xl border border-(--color-line) bg-white shadow-[0_1px_2px_rgba(34,36,42,.04)] transition hover:border-(--color-primary) hover:shadow-[0_12px_26px_-16px_rgba(34,36,42,.35)]"
                >
                  <Link
                    href={`/tavla/${b.slug}?ar=${now.year}&vecka=${now.week}`}
                    className="flex flex-1 flex-col gap-4 px-5 pt-5"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex flex-col gap-1">
                        <span className="text-xl font-semibold">{b.name}</span>
                        <span className="text-[13px] text-(--color-muted)">
                          {antal(b.visibleWeekdays.length, "dag", "dagar")} · start{" "}
                          {b.weekStartsOn === 0 ? "söndag" : "måndag"} ·{" "}
                          {b.visibleShifts.length > 1 ? "dag och natt" : "bara dag"}
                        </span>
                      </span>
                      {/* Kortet är en länk, och det ska synas utan att man
                          först måste föra musen över det. */}
                      <span aria-hidden className="text-lg text-(--color-dim)">
                        →
                      </span>
                    </span>

                    {/* Veckans läge, inte bara ett namn att klicka på.
                        Tal som går att räkna i databasen utan att tolka
                        något — se board-overview.ts för varför "ej utlagda"
                        inte står här. Designförslaget hade "37 tomma pass
                        kvar" på den här platsen; det talet finns bara på
                        tavlan själv, där passens tider redan tolkats, och
                        att räkna fram det en andra gång i SQL vore en andra
                        sanning som kan säga emot den första. */}
                    <span className="flex gap-6">
                      <Tal
                        värde={o?.assignments ?? 0}
                        etikett="utlagda pass"
                        ton={tomt ? "svag" : undefined}
                      />
                      <Tal
                        värde={o?.crew ?? 0}
                        etikett="i bemanning"
                        ton={(o?.crew ?? 0) === 0 ? "svag" : undefined}
                      />
                      <Tal värde={o?.rows ?? 0} etikett="rader" />
                    </span>
                  </Link>

                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-(--color-line-soft) px-5 py-3 text-[12.5px] font-semibold">
                    {/* Kortets kvitto: det som är värt att veta innan man
                        öppnar tavlan. Frånvaro först — den är det enda som
                        kräver ett beslut. */}
                    {(o?.absent ?? 0) > 0 ? (
                      <span className="flex min-w-0 items-center gap-2 text-(--color-warn)">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-brand-amber)"
                        />
                        <span className="truncate">
                          {antal(o!.absent, "frånvarande", "frånvarande")}
                        </span>
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-2 text-(--color-muted)">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-dim)"
                        />
                        <span className="truncate">
                          {tomt ? "Inget utlagt än" : "Veckan är igång"}
                        </span>
                      </span>
                    )}

                    <span className="flex shrink-0 items-center gap-3 whitespace-nowrap">
                      <Link
                        href={`/tavla/${b.slug}/semester?ar=${now.year}`}
                        className="text-(--color-label) hover:underline"
                      >
                        Semester
                      </Link>
                      {/* Listan visar bara tavlor man har tillgång till,
                          och servern prövar ändringsrätt på just den
                          tavlan. Den som byggt en tavla ska få riva den
                          igen. */}
                      {ändringsbar(b.id) && (
                        <RemoveBoardButton boardId={b.id} boardName={b.name} />
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <NewBoardForm templates={TEMPLATE_LABELS} />
        </>
      )}
    </main>
  );
}
