import type { BoardWeek } from "@/server/board-week";
import { shortDayLabel } from "@/lib/week";

const ABSENCE_ICON: Record<string, string> = {
  semester: "🏖",
  sjuk: "🤒",
  vab: "🧒",
  tjanstledig: "📄",
  foraldraledig: "🍼",
  kompledig: "⏱",
  ovrig: "•",
};

/**
 * Samma vecka med personerna som rader.
 *
 * Det är vad trafikledningens och Hudiksvalls Excel-blad gör i dag —
 * men här är det en vy av samma tilldelningar, inte en andra kopia som
 * någon måste hålla i takt.
 */
export function PersonGrid({ data }: { data: BoardWeek }) {
  if (data.personRows.length === 0) {
    return (
      <p className="rounded border border-(--color-line) bg-white p-6 text-sm text-(--color-muted)">
        Inga bokade förare den här veckan.
      </p>
    );
  }

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
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-(--color-line) bg-white px-3 py-2 text-left font-medium whitespace-nowrap"
              >
                {p.name}
              </th>
              {p.days.map((d) => (
                <td key={d.date} className="border-b border-l border-(--color-line) px-3 py-2">
                  {d.absence ? (
                    <span className="text-(--color-warn)">
                      {ABSENCE_ICON[d.absence.type] ?? "•"} {d.absence.type}
                    </span>
                  ) : d.entries.length === 0 ? (
                    <span className="text-(--color-muted)">▢</span>
                  ) : (
                    d.entries.map((e, i) => (
                      <span key={i} className="block">
                        {e.rowLabel}
                        {e.vehicleName && (
                          <span className="ml-1 text-xs text-(--color-muted)">{e.vehicleName}</span>
                        )}
                      </span>
                    ))
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
