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

/**
 * Färger i årsvyn, ur omgång 2 av den grafiska profilen.
 *
 * Semester är den vanliga och får den tydligaste tonen. Alla sju är
 * mörka nog för vit text ovanpå — staplarna bär sin egen etikett, och
 * en stapel man inte kan läsa namnet på är en färgad rand utan mening.
 * Svagast är VAB på 4,5:1, starkast Tjänstledig på 6,6:1.
 *
 * VAB står som #BC5B1B och inte profilens #C25E1C: den gav 4,3:1 med
 * vit text ovanpå, och etiketterna i staplarna är 11 px feta — för
 * små för att räknas som stor text. En nyans mörkare räcker.
 */
export const ABSENCE_COLOR: Record<AbsenceType, string> = {
  semester: "#1F5FB0",
  sjuk: "#B3261E",
  vab: "#BC5B1B",
  tjanstledig: "#5A5D64",
  foraldraledig: "#7A3FD4",
  kompledig: "#0E6B5C",
  ovrig: "#6E7168",
};

export function isAbsenceType(v: string): v is AbsenceType {
  return (ABSENCE_TYPES as readonly string[]).includes(v);
}
