import type { Shift } from "@/lib/work-days";

/**
 * Id:n för dra och släpp.
 *
 * Kodade som strängar eftersom dnd-kit bara bär id:t genom dragningen;
 * att tolka det på ett ställe håller isär de tre sorternas semantik.
 */
export const dragId = {
  crew: (employeeId: string) => `crew:${employeeId}`,
  assignment: (assignmentId: string) => `asg:${assignmentId}`,
  cell: (boardRowId: string, date: string, shift: Shift) => `cell:${boardRowId}|${date}|${shift}`,
  crewPanel: "crew-panel",
} as const;

export type DragSource =
  | { kind: "crew"; employeeId: string }
  | { kind: "assignment"; assignmentId: string };

export type DropTarget =
  | { kind: "cell"; boardRowId: string; date: string; shift: Shift }
  | { kind: "crew-panel" };

export function parseDragId(id: string): DragSource | null {
  if (id.startsWith("crew:")) return { kind: "crew", employeeId: id.slice(5) };
  if (id.startsWith("asg:")) return { kind: "assignment", assignmentId: id.slice(4) };
  return null;
}

export function parseDropId(id: string): DropTarget | null {
  if (id === dragId.crewPanel) return { kind: "crew-panel" };
  if (id.startsWith("cell:")) {
    const [boardRowId, date, shift] = id.slice(5).split("|");
    if (boardRowId && date && (shift === "day" || shift === "night")) {
      return { kind: "cell", boardRowId, date, shift };
    }
  }
  return null;
}
