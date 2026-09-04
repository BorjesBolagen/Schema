"use client";

import { useMemo, useState, useTransition } from "react";
import type { VacationYear as YearData, VacationRow } from "@/server/vacation-year";
import { ABSENCE_COLOR, ABSENCE_LABEL, ABSENCE_TYPES, type AbsenceType } from "@/lib/absence";
import { clearAbsenceWeek, setAbsenceWeeks } from "@/app/actions";
import { mondayOfWeek, parseIso } from "@/lib/week";

const MONTHS = ["jan", "feb", "mars", "april", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

/** Månadsrubrikerna, som spann över de veckor som börjar i månaden. */
function monthSpans(year: number, weeks: number[]) {
  const spans: Array<{ month: number; label: string; span: number }> = [];
  for (const w of weeks) {
    const month = parseIso(mondayOfWeek(year, w)).getUTCMonth();
    const last = spans[spans.length - 1];
    if (last && last.month === month) last.span++;
    else spans.push({ month, label: MONTHS[month], span: 1 });
  }
  return spans;
}

/**
 * En frånvaro blir en sammanhängande stapel.
 *
 * weeksOfSpan klipper spannet mot årets kanter, så en frånvaro som
 * löper över nyår ger ett hål mitt i listan i stället för i änden.
 * Därför delas veckorna i sammanhängande löpor i stället för att antas
 * vara en enda — en stapel som spänner över ett hål vore en lögn om
 * när personen faktiskt är borta.
 */
interface Stapel {
  key: string;
  type: AbsenceType;
  status: "requested" | "approved";
  från: number;
  till: number;
  titel: string;
}

function staplar(row: VacationRow): Stapel[] {
  const ut: Stapel[] = [];
  for (const a of row.absences) {
    const v = [...a.weeks].sort((x, y) => x - y);
    let i = 0;
    while (i < v.length) {
      let j = i;
      while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++;
      ut.push({
        key: `${a.id}:${v[i]}`,
        type: a.type,
        status: a.status,
        från: v[i],
        till: v[j],
        titel: `${ABSENCE_LABEL[a.type]} ${a.fromDate} – ${a.toDate}${
          a.status === "requested" ? " (önskemål)" : ""
        }`,
      });
      i = j + 1;
    }
  }
  return ut;
}

/** Fältens form i reglageraden. */
const FÄLT =
  "h-[38px] rounded-[9px] border-[1.5px] border-(--color-field-line) bg-white px-2.5 text-[13.5px] font-semibold text-(--color-ink) outline-none transition focus:border-(--color-primary)";
const FÄLTETIKETT =
  "text-[11px] font-bold tracking-[.06em] text-(--color-muted) uppercase";

/**
 * Semester- och frånvaroplanering för ett helt år.
 *
 * Dra över veckor för att markera. Bemanningsraden längst ned räknar hur
 * många som är kvar varje vecka och varnar under den nivå ni satt — det
 * som i Excel upptäcks först när en vecka visar sig omöjlig att bemanna.
 *
 * Ritas som ett band och inte som ett rutnät av rutor. Femtiotvå färgade
 * celler per person läses en i taget; en stapel med "Semester · v29–v32"
 * i sig läses på en blick, och året får en rytm av månadsbandet i stället
 * för av veckolinjerna. Rutorna finns kvar under staplarna som ett
 * osynligt lager — det är de som tar emot dragningen, vecka för vecka.
 */
export function VacationYear({ data }: { data: YearData }) {
  const [type, setType] = useState<AbsenceType>("semester");
  const [status, setStatus] = useState<"approved" | "requested">("approved");
  const [minStaff, setMinStaff] = useState(Math.max(1, Math.ceil(data.crewSize * 0.5)));
  const [drag, setDrag] = useState<{ employeeId: string; from: number; to: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const selection = useMemo(() => {
    if (!drag) return null;
    const [a, b] = [drag.from, drag.to].sort((x, y) => x - y);
    return { employeeId: drag.employeeId, weeks: Array.from({ length: b - a + 1 }, (_, i) => a + i) };
  }, [drag]);

  /** Frånvaron som täcker en vecka, om någon. */
  const absenceAt = (row: VacationRow, week: number) =>
    row.absences.find((a) => a.weeks.includes(week));

  function commit() {
    if (!selection) return;
    const { employeeId, weeks } = selection;
    setDrag(null);

    const row = data.rows.find((r) => r.employeeId === employeeId);
    const allMarked = row && weeks.every((w) => absenceAt(row, w));

    startTransition(async () => {
      if (allMarked) {
        // Dra över redan markerade veckor tar bort dem igen.
        for (const week of weeks) {
          await clearAbsenceWeek({ employeeId, year: data.year, week, boardSlug: data.board.slug });
        }
      } else {
        await setAbsenceWeeks({
          employeeId,
          year: data.year,
          weeks,
          type,
          status,
          boardSlug: data.board.slug,
        });
      }
    });
  }

  const veckor = data.weeks;
  const antalVeckor = veckor.length;
  /* Veckans plats i bandet, i procent. Spåren är lika breda, så en
     stapel går att räkna ut ur veckonumren utan att mäta något. */
  const vänster = (vecka: number) => ((vecka - veckor[0]) / antalVeckor) * 100;
  const bredd = (från: number, till: number) => ((till - från + 1) / antalVeckor) * 100;

  /* Den månad som pågår, understruken i märkesgult. Designen strök under
     juli och augusti; vilka månader som är semesterperiod är en regel
     om verksamheten och inte något koden vet, medan "nu" är det. */
  const idag = new Date();
  const dennaMånad = idag.getFullYear() === data.year ? idag.getMonth() : null;

  const RAD = "grid" as const;
  const rutnät = { gridTemplateColumns: "210px 1fr" };
  const veckospår = { gridTemplateColumns: `repeat(${antalVeckor}, minmax(0, 1fr))` };

  return (
    <div onMouseUp={commit} onMouseLeave={() => drag && commit()}>
      <div className="mb-4 flex flex-wrap items-end gap-3 no-print">
        <label className="flex flex-col gap-1.5">
          <span className={FÄLTETIKETT}>Typ</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AbsenceType)}
            className={FÄLT}
          >
            {ABSENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ABSENCE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={FÄLTETIKETT}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={FÄLT}
          >
            <option value="approved">Beviljad</option>
            <option value="requested">Önskemål</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={FÄLTETIKETT}>Varna under</span>
          <input
            type="number"
            min={0}
            max={data.crewSize}
            value={minStaff}
            onChange={(e) => setMinStaff(Number(e.target.value))}
            className={`${FÄLT} w-[76px] tabular-nums`}
          />
        </label>

        {pending && (
          <p className="pb-2.5 text-[13px] font-semibold text-(--color-muted)">Sparar…</p>
        )}
      </div>

      <div className="grid-scroll rounded-xl border border-(--color-line) bg-white">
        <div className="min-w-[1180px] select-none print:min-w-0">
          {/* Månadsbandet ger året sin rytm. Varannan månad tonad — det
              säger var man är utan en enda linje till. */}
          <div className={`${RAD} border-b border-(--color-line) bg-(--color-field)`} style={rutnät}>
            <div className="sticky left-0 z-20 bg-(--color-field) px-4 py-2.5 text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase">
              Person
            </div>
            <div className={RAD} style={veckospår}>
              {monthSpans(data.year, veckor).map((m, i) => (
                <div
                  key={i}
                  style={{ gridColumn: `span ${m.span}` }}
                  className={`border-l border-(--color-line-soft) px-2 py-2.5 text-xs font-bold ${
                    i % 2 === 1 ? "bg-[#FCFBF8]" : ""
                  } ${
                    m.month === dennaMånad
                      ? "text-(--color-ink) shadow-[inset_0_-3px_0_var(--color-brand)]"
                      : "text-(--color-label)"
                  }`}
                >
                  {m.span > 1 ? m.label : ""}
                </div>
              ))}
            </div>
          </div>

          {/* Veckonumren. Designens mock visade bara månader, men den som
              lägger in en semester anger vecka och inte månad — numret
              måste gå att läsa av utan att räkna spår. */}
          <div className={`${RAD} border-b border-(--color-line-soft)`} style={rutnät}>
            <div className="sticky left-0 z-20 bg-white px-4 py-1" />
            <div className={`${RAD} tabular-nums`} style={veckospår}>
              {veckor.map((w) => (
                <div
                  key={w}
                  className="border-l border-(--color-line-soft) py-1 text-center text-[10px] text-(--color-muted)"
                >
                  {w % 2 === 1 ? w : ""}
                </div>
              ))}
            </div>
          </div>

          {data.rows.map((row, ri) => {
            const vald = selection?.employeeId === row.employeeId ? selection.weeks : null;
            return (
              <div
                key={row.employeeId}
                className={`${RAD} border-b border-(--color-line-soft) ${
                  ri % 2 === 1 ? "bg-[#FCFBF9]" : "bg-white"
                }`}
                style={rutnät}
              >
                <div
                  className={`sticky left-0 z-20 truncate px-4 py-2.5 text-[13.5px] font-semibold ${
                    ri % 2 === 1 ? "bg-[#FCFBF9]" : "bg-white"
                  }`}
                  title={row.name}
                >
                  {row.name}
                  {row.stationPlace && (
                    <span className="ml-2 font-normal text-(--color-muted)">
                      {row.stationPlace}
                    </span>
                  )}
                </div>

                <div className="relative h-[38px] border-l border-(--color-line-soft)">
                  {/* Interaktionslagret: en ruta per vecka, osynlig utom
                      för sina linjer. Det ligger under staplarna men tar
                      emot dragningen, eftersom staplarna släpper igenom
                      pekaren. */}
                  <div className={`absolute inset-0 ${RAD}`} style={veckospår}>
                    {veckor.map((w) => (
                      <div
                        key={w}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setDrag({ employeeId: row.employeeId, from: w, to: w });
                        }}
                        onMouseEnter={() =>
                          drag?.employeeId === row.employeeId && setDrag({ ...drag, to: w })
                        }
                        title={`Vecka ${w}`}
                        className="cursor-pointer border-l border-[#F4F2EC] first:border-l-0"
                      />
                    ))}
                  </div>

                  {staplar(row).map((s) => {
                    const färg = ABSENCE_COLOR[s.type];
                    const beviljad = s.status === "approved";
                    const längd = s.till - s.från + 1;
                    return (
                      <div
                        key={s.key}
                        title={s.titel}
                        className={`pointer-events-none absolute top-[7px] bottom-[7px] flex items-center overflow-hidden rounded-md px-2 text-[11px] font-bold whitespace-nowrap ${
                          beviljad ? "text-white" : "border-[1.5px] border-dashed"
                        }`}
                        style={{
                          left: `${vänster(s.från)}%`,
                          width: `${bredd(s.från, s.till)}%`,
                          /* Beviljat är fyllt, önskemål ihåligt. Opacitet
                             på hela stapeln — som stod här förut — bleker
                             även etiketten, och en text i 11 px tål det
                             inte. Konturen säger "inte beslutat än" utan
                             att kosta läsbarhet. */
                          background: beviljad
                            ? färg
                            : `color-mix(in srgb, ${färg} 14%, white)`,
                          borderColor: beviljad ? undefined : färg,
                          color: beviljad ? undefined : färg,
                          printColorAdjust: "exact",
                          WebkitPrintColorAdjust: "exact",
                        }}
                      >
                        {/* Etiketten bara när den ryms.
                            Ett veckospår är som smalast (1180 px minus
                            personkolumnen, delat på 52) knappt 19 px.
                            "Semester" i 11 px fet tar omkring 58 px plus
                            16 px luft, alltså fem spår; hela strängen med
                            veckonumren tar ungefär det dubbla. Under det
                            ritas ingen text — en avhuggen etikett säger
                            mindre än färgen ensam, och hela texten finns
                            i tooltipen. */}
                        {längd >= 9
                          ? `${ABSENCE_LABEL[s.type]} · v${s.från}–v${s.till}`
                          : längd >= 5
                            ? ABSENCE_LABEL[s.type]
                            : ""}
                      </div>
                    );
                  })}

                  {vald && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-[3px] bottom-[3px] rounded-md ring-2 ring-(--color-primary) ring-inset"
                      style={{
                        left: `${vänster(vald[0])}%`,
                        width: `${bredd(vald[0], vald[vald.length - 1])}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Bemanning kvar. Två nivåer i stället för en: rött när veckan
              redan ligger under gränsen, gult när den ligger precis på
              den — nästa ansökan är då den som spräcker den, och det är
              värt att se innan man beviljar den. */}
          <div className={`${RAD} border-t border-(--color-line) bg-(--color-field)`} style={rutnät}>
            <div className="sticky left-0 z-20 bg-(--color-field) px-4 py-3 text-[12.5px] font-bold">
              Bemanning kvar
            </div>
            <div className={`${RAD} tabular-nums`} style={veckospår}>
              {veckor.map((w) => {
                const n = data.availablePerWeek[w] ?? 0;
                const under = n < minStaff;
                const påGränsen = n === minStaff;
                return (
                  <div
                    key={w}
                    title={
                      under
                        ? `Vecka ${w}: bara ${n} kvar, under gränsen ${minStaff}`
                        : påGränsen
                          ? `Vecka ${w}: ${n} kvar, precis på gränsen`
                          : `Vecka ${w}: ${n} kvar`
                    }
                    className={`border-l border-(--color-line-soft) py-3 text-center text-xs font-bold ${
                      under
                        ? "bg-[#FBE3D6] text-[#8A2F0B]"
                        : påGränsen
                          ? "bg-(--color-brand-wash) text-(--color-label)"
                          : "text-(--color-label)"
                    }`}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <ul className="flex flex-wrap gap-2">
          {ABSENCE_TYPES.map((t) => (
            <li
              key={t}
              className="flex items-center gap-2 rounded-full border border-(--color-line) bg-white px-3 py-1.5 text-[12.5px] font-semibold text-(--color-label)"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ backgroundColor: ABSENCE_COLOR[t] }}
              />
              {ABSENCE_LABEL[t]}
            </li>
          ))}
          <li className="flex items-center gap-2 rounded-full border border-(--color-line) bg-white px-3 py-1.5 text-[12.5px] font-semibold text-(--color-label)">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-dashed border-(--color-label)"
            />
            Önskemål
          </li>
        </ul>
        <p className="text-[12.5px] text-(--color-muted) no-print">
          Dra över veckor för att markera · dra över dem igen för att ta bort
        </p>
      </div>
    </div>
  );
}
