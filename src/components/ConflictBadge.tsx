import type { Conflict } from "@/lib/conflicts";

const LABEL: Record<Conflict["kind"], string> = {
  "double-booked": "Dubbelbokad",
  "vehicle-clash": "Bilen används på annan rad",
  absent: "Frånvarande",
  unmanned: "Obemannad",
};

export function conflictTitle(c: Conflict): string {
  switch (c.kind) {
    case "double-booked":
      return `Dubbelbokad — står även på ${c.places.filter(Boolean).join(", ")}`;
    case "vehicle-clash":
      return `Bilen står även på ${c.places.filter(Boolean).join(", ")}`;
    case "absent":
      return `Inplanerad under ${c.absenceType}`;
    case "unmanned":
      return "Obemannat pass";
  }
}

export function ConflictMark({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;
  const worst = conflicts.find((c) => c.kind === "absent") ?? conflicts[0];
  return (
    <span
      title={conflicts.map(conflictTitle).join("\n")}
      aria-label={LABEL[worst.kind]}
      className="ml-1 shrink-0 text-(--color-danger)"
    >
      ⚠
    </span>
  );
}
