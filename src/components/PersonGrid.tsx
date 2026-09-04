import type { BoardWeek } from "@/server/board-week";
import type { Shift } from "@/lib/work-days";
import { shortDayLabel } from "@/lib/week";
import { ABSENCE_ICON, SHIFT_COLOR, SHIFT_INITIAL, SHIFT_LABEL } from "./shift";

/**
 * Skiftets bricka, samma som i bilvyn.
 *
 * Här stod förut ☀️ och 🌙. De läses var för sig, men en tavla med
 * fem dagar gånger tolv personer blev sextio emoji i ett rutnät — och
 * framför allt: samma pass såg ut på ett sätt i bilvyn och ett annat
 * här, trots att det är samma vecka. Ett byte av flik ska inte vara ett
 * byte av språk.
 */
function SkiftBricka({ shift }: { shift: Shift }) {
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] text-[8px] leading-none font-bold"
      style={{
        background: SHIFT_COLOR[shift],
        color: shift === "day" ? "var(--color-brand-deep)" : "#fff",
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
      title={SHIFT_LABEL[shift]}
    >
      {SHIFT_INITIAL[shift]}
    </span>
  );
}

/**
 * Samma vecka med personerna som rader.
 *
 * Det är vad Excel-bladen TRAFIKLEDNING och Hudiksvall underhåller som
 * separata kopior i dag — här är det en vy av samma pass, inte en andra
 * sanning att hålla i takt.
 */
export function PersonGrid({ data }: { data: BoardWeek }) {
  if (data.personRows.length === 0) {
    return (
      <p className="rounded-xl border border-(--color-line) bg-white p-6 text-sm text-(--color-muted)">
        Ingen bemanning vald för den här tavlan ännu.
      </p>
    );
  }

  const showShift = data.shifts.length > 1;

  return (
    <div className="grid-scroll rounded-xl border border-(--color-line) bg-white">
      <table className="w-full min-w-[900px] table-fixed border-collapse text-sm print:min-w-0">
        <colgroup>
          <col className="w-[200px]" />
          {data.dates.map((d) => (
            <col key={d} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-(--color-field)">
            <th className="sticky left-0 z-10 border-b border-(--color-line) bg-(--color-field) px-3 py-2.5 text-left text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase">
              Person
            </th>
            {data.dates.map((d) => (
              <th
                key={d}
                className="border-b border-l border-(--color-line-soft) px-2.5 py-2.5 text-left text-[11px] font-bold tracking-[.07em] text-(--color-muted) uppercase"
              >
                {shortDayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.personRows.map((p) => (
            <tr key={p.employeeId} className="align-top">
              {/* Personens rand är borta med pastellpaletten. Hela raden
                  är personen och namnet står först — randen bar ingen
                  upplysning som inte redan fanns där, och den var det
                  sista stället där en kulör betydde "vem" i stället för
                  "vad". */}
              <th
                scope="row"
                className="sticky left-0 z-10 truncate border-b border-(--color-line) bg-white px-3 py-2 text-left font-semibold"
                title={p.name}
              >
                {p.name}
              </th>
              {p.days.map((d) => (
                <td
                  key={d.date}
                  className="border-b border-l border-(--color-line-soft) px-2.5 py-2"
                >
                  {d.absence ? (
                    <span className="flex items-center gap-1.5 text-(--color-warn)">
                      <span aria-hidden>{ABSENCE_ICON[d.absence.type] ?? "•"}</span>
                      {d.absence.type}
                    </span>
                  ) : d.entries.length > 0 ? (
                    d.entries.map((e, i) => (
                      <span key={i} className="flex min-w-0 items-center gap-1.5">
                        {showShift && <SkiftBricka shift={e.shift} />}
                        <span className="truncate">{e.rowLabel}</span>
                        {e.vehicleName && e.vehicleName !== e.rowLabel && (
                          <span className="shrink-0 text-xs text-(--color-muted)">
                            {e.vehicleName}
                          </span>
                        )}
                      </span>
                    ))
                  ) : d.worksButUnplaced ? (
                    <span className="text-(--color-warn)" title="Jobbar men står inte på någon bil">
                      ⚠ ej utlagd
                    </span>
                  ) : (
                    /* Ledig dag. Punkten är samma tecken som
                       sidopanelen använder för en dag utan pass — en ▢
                       läser man som en tom ruta att fylla, vilket den
                       inte är här. */
                    <span className="text-(--color-dim)" aria-label="ledig">
                      ·
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
