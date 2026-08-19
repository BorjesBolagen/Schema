import { type Grid, text } from "./xlsx";

/**
 * Fält vi läser ur Personallista.
 *
 * Bladet innehåller även personnummer, hemadress och förarkortnummer.
 * De hämtas medvetet inte — schemaverktyget har ingen användning för
 * dem, och uppgifter som aldrig importeras kan heller inte läcka.
 */
export interface PersonRecord {
  firstName: string;
  lastName: string;
  displayAlias: string | null;
  signature: string | null;
  employeeNumber: string | null;
  email: string | null;
  phone: string | null;
  supervisor: string | null;
  stationPlaceText: string | null;
  trafficAreaText: string | null;
  vacationGroup: string | null;
  workGroup: string | null;
  isActive: boolean;
}

const COL = {
  firstName: 0,
  lastName: 1,
  displayAlias: 2, // rubriken heter "Kolumn1" men innehåller visningsnamnet
  signature: 3,
  employeeNumber: 4,
  phoneWork: 6,
  phonePrivate: 7,
  email: 9,
  supervisor: 10,
  stationPlace: 11,
  trafficArea: 12,
  vacationGroup: 13,
  workGroup: 14,
  isActive: 21,
} as const;

const nullable = (v: string): string | null => (v === "" ? null : v);

export function parsePersonallista(grid: Grid): PersonRecord[] {
  const out: PersonRecord[] = [];
  for (let r = 1; r < grid.length; r++) {
    const firstName = text(grid, r, COL.firstName);
    const lastName = text(grid, r, COL.lastName);
    if (!firstName && !lastName) continue;

    out.push({
      firstName,
      lastName,
      displayAlias: nullable(text(grid, r, COL.displayAlias)),
      signature: nullable(text(grid, r, COL.signature)),
      employeeNumber: nullable(text(grid, r, COL.employeeNumber)),
      email: nullable(text(grid, r, COL.email)),
      phone: nullable(text(grid, r, COL.phoneWork)) ?? nullable(text(grid, r, COL.phonePrivate)),
      supervisor: nullable(text(grid, r, COL.supervisor)),
      stationPlaceText: nullable(text(grid, r, COL.stationPlace)),
      trafficAreaText: nullable(text(grid, r, COL.trafficArea)),
      vacationGroup: nullable(text(grid, r, COL.vacationGroup)),
      workGroup: nullable(text(grid, r, COL.workGroup)),
      isActive: text(grid, r, COL.isActive).toLowerCase() !== "false",
    });
  }
  return out;
}
