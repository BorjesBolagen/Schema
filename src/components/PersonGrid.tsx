import type { BoardWeek } from "@/server/board-week";
import { shortDayLabel } from "@/lib/week";
import { ABSENCE_ICON, SHIFT_ICON } from "./shift";
import { personColor } from "@/lib/person-color";

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
      <p className="rounded border border-(--color-line) bg-white p-6 text-sm text-(--color-muted)">
        Ingen bemanning vald för den här tavlan ännu.
      </p>
    );
  }

  const showShift = data.shifts.length > 1;

  return (
    <div className="grid-scroll rounded border border-(--color-line) bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-10 border-b border-(--color-line) bg-gray-50 px-3 py-2 text-left font-medium">
              Person
            </th>
            {data.dates.map((d) => (
              <th
                key={d}
                className="min-w-32 border-b border-l border-(--color-line) px-3 py-2 text-left font-medium"
              >
                {shortDayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.personRows.map((p) => (
            <tr key={p.employeeId} className="align-top">
              {/* Samma kulör som personens kort i bilvyn, som en rand i
                  stället för en fyllning: här är hela raden personen, så
                  en fylld cell skulle bara måla rubrikkolumnen. */}
              <th
                scope="row"
                style={{
                  borderLeftColor: personColor(p.employeeId).border,
                  printColorAdjust: "exact",
                  WebkitPrintColorAdjust: "exact",
                }}
                className="sticky left-0 z-10 border-b border-l-4 border-(--color-line) bg-white px-3 py-2 text-left font-medium whitespace-nowrap"
              >
                {p.name}
              </th>
              {p.days.map((d) => (
                <td key={d.date} className="border-b border-l border-(--color-line) px-3 py-2">
                  {d.absence ? (
                    <span className="text-(--color-warn)">
                      {ABSENCE_ICON[d.absence.type] ?? "•"} {d.absence.type}
                    </span>
                  ) : d.entries.length > 0 ? (
                    d.entries.map((e, i) => (
                      <span key={i} className="block">
                        {showShift && <span className="mr-1">{SHIFT_ICON[e.shift]}</span>}
                        {e.rowLabel}
                        {e.vehicleName && e.vehicleName !== e.rowLabel && (
                          <span className="ml-1 text-xs text-(--color-muted)">{e.vehicleName}</span>
                        )}
                      </span>
                    ))
                  ) : d.worksButUnplaced ? (
                    <span className="text-(--color-warn)" title="Jobbar men står inte på någon bil">
                      ⚠ ej utlagd
                    </span>
                  ) : (
                    <span className="text-(--color-muted)">▢</span>
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
