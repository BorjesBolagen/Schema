/** Frånvarotyper och deras svenska namn. */
export const ABSENCE_TYPES = [
  "semester",
  "sjuk",
  "vab",
  "tjanstledig",
  "foraldraledig",
  "kompledig",
  "ovrig",
] as const;

export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_LABEL: Record<AbsenceType, string> = {
  semester: "Semester",
  sjuk: "Sjuk",
  vab: "VAB",
  tjanstledig: "Tjänstledig",
  foraldraledig: "Föräldraledig",
  kompledig: "Kompledig",
  ovrig: "Övrig",
};

/** Färger i årsvyn. Semester är den vanliga och får den tydligaste tonen. */
export const ABSENCE_COLOR: Record<AbsenceType, string> = {
  semester: "#1f5fa9",
  sjuk: "#b42318",
  vab: "#b45309",
  tjanstledig: "#6b7280",
  foraldraledig: "#7c3aed",
  kompledig: "#0f766e",
  ovrig: "#9ca3af",
};

export function isAbsenceType(v: string): v is AbsenceType {
  return (ABSENCE_TYPES as readonly string[]).includes(v);
}
