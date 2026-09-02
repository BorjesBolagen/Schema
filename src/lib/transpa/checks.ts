/**
 * Vad man kan fråga TransPA, en fråga i taget.
 *
 * Diagnostiksidan svepte förut över allt varje gång den renderades — ett
 * trettiotal anrop — och prenumerationens anropskvot tog slut mitt i
 * arbetet. Kvoten delas med synken, som är det verktyget faktiskt lever
 * av, så en sida som ritar om sig får inte äta av den.
 *
 * Därför är varje fråga sitt eget val, med sin kostnad utskriven. Den
 * som vill veta om passvägen svarar betalar tre anrop, inte trettio.
 *
 * Ren data, utan beroenden, så listan går att läsa och prova utan att
 * något anropas.
 */

export interface CheckSelection {
  paths?: readonly string[] | "alla";
  spec?: boolean;
  sampleEmployee?: boolean;
  trips?: boolean;
  grouping?: boolean;
  shiftVariants?: boolean;
}

export interface Check {
  /** Står i adressen: /transpa?kor=pass */
  id: string;
  label: string;
  /** Frågan körningen besvarar, i klartext. */
  what: string;
  /**
   * Anrop mot API:t. Räknat, inte gissat — se calls() nedan.
   * Spec-läsningen ligger på dokumentvärden och räknas separat.
   */
  calls: number;
  selection: CheckSelection;
}

const INGET: CheckSelection = {
  paths: [],
  spec: false,
  sampleEmployee: false,
  trips: false,
  grouping: false,
  shiftVariants: false,
};

export const CHECKS: Check[] = [
  {
    id: "anslutning",
    label: "Går anslutningen fram?",
    what: "Token och /v1/alive. Det minsta som svarar på om uppgifterna stämmer och kvoten är öppen igen.",
    calls: 1,
    selection: { ...INGET, paths: ["/v1/alive"] },
  },
  {
    id: "pass",
    label: "Svarar passvägen?",
    what: "/v1/shifts/ och passen under en person — vägen både hämtningen och skickandet av schemaändringar går genom.",
    calls: 3,
    selection: {
      ...INGET,
      paths: ["/v1/shifts/", "/v1/employees/{id}/shifts/"],
      sampleEmployee: true,
    },
  },
  {
    id: "personal",
    label: "Vad bär en person för fält?",
    what: "/v1/employees, en rad. Avgör om stationsort finns i TransPA eller måste sättas här.",
    calls: 1,
    selection: { ...INGET, paths: ["/v1/employees"] },
  },
  {
    id: "spec",
    label: "Vad säger specen?",
    what: "Läser OpenAPI-dokumentet. Ligger på dokumentvärden och kostar inga API-anrop — men säger bara vad som är dokumenterat, inte vad tenanten svarar.",
    calls: 0,
    selection: { ...INGET, spec: true },
  },
  {
    id: "skrivpass",
    label: "Hur skriver man ett pass?",
    what: "Varje passväg i specen, metod för metod, med sina parametrar. Läser bara dokumentet — svarar på varför PUT ger 404 när GET mot samma adress lyckas.",
    calls: 0,
    selection: { ...INGET, spec: true },
  },
  {
    id: "allt",
    label: "Hela svepningen",
    what: "Varje väg, turfönstret, grupperingen och passvarianterna. Den fullständiga bilden — och den dyra.",
    calls: 30,
    selection: {
      paths: "alla",
      spec: true,
      sampleEmployee: true,
      trips: true,
      grouping: true,
      shiftVariants: true,
    },
  },
];

export function checkById(id: string | undefined): Check | undefined {
  return CHECKS.find((c) => c.id === id);
}

/** "3 anrop" / "inga API-anrop" — kostnaden som den ska läsas. */
export function costLabel(check: Check): string {
  if (check.calls === 0) return "inga API-anrop";
  if (check.calls === 1) return "1 anrop";
  return check.id === "allt" ? `~${check.calls} anrop` : `${check.calls} anrop`;
}
