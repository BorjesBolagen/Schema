import type { Conflict } from "@/lib/conflicts";

const LABEL: Record<Conflict["kind"], string> = {
  "double-booked": "Dubbelbokad",
  "vehicle-clash": "Bilen används på annan rad",
  "day-and-night": "Dag- och nattpass samma dygn",
  "shift-mismatch": "Fel skift mot TransPA",
  absent: "Frånvarande",
  unmanned: "Obemannad",
};

export function conflictTitle(c: Conflict): string {
  switch (c.kind) {
    case "double-booked":
      return `Dubbelbokad — står även på ${c.places.filter(Boolean).join(", ")}`;
    case "vehicle-clash":
      return `Bilen står även på ${c.places.filter(Boolean).join(", ")}`;
    case "day-and-night":
      return "Både dag- och nattpass samma dygn";
    case "shift-mismatch":
      return `Utlagd på ${c.placed === "night" ? "natt" : "dag"}, men planerad på ${
        c.planned === "night" ? "natt" : "dag"
      } i TransPA`;
    case "absent":
      return `Inplanerad under ${c.absenceType}`;
    case "unmanned":
      return "Obemannat pass";
  }
}

export function ConflictMark({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;
  const severity: Record<Conflict["kind"], number> = {
    absent: 0,
    "double-booked": 1,
    "vehicle-clash": 2,
    "day-and-night": 3,
    // Fel skift är ingen krock — passet finns, det står bara på fel rad.
    "shift-mismatch": 4,
    unmanned: 5,
  };
  const worst = [...conflicts].sort((a, b) => severity[a.kind] - severity[b.kind])[0];
  return (
    <span
      title={conflicts.map(conflictTitle).join("\n")}
      aria-label={LABEL[worst.kind]}
      className={`ml-1 shrink-0 ${
        worst.kind === "day-and-night" || worst.kind === "shift-mismatch"
          ? "text-(--color-warn)"
          : "text-(--color-danger)"
      }`}
    >
      ⚠
    </span>
  );
}
