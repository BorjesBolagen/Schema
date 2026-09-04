import type { Shift } from "@/lib/work-days";

/**
 * Skiftets färg, samma överallt.
 *
 * Emojin duger i en cell men inte i en kolumn: ett ☀️ per skiftrad blev
 * sexton solar och månar i en smal spalt, och de drog till sig mer
 * uppmärksamhet än namnen de skulle märka upp. En liten färgruta säger
 * samma sak och håller sig i bakgrunden.
 *
 * Omgång 2 låter paret bära mer än så. Kulörerna satt tidigare på
 * personen — tolv pastellfärger i en egen modul — och skiftet var
 * bara en ruta i en smal kolumn. Nu är det tvärtom: amber är dag, blått
 * är natt, och samma två färger går igen i passen, i skiftkolumnen och i
 * bemanningens veckoremsa. En person går då att läsa av utan att man
 * först lärt sig vilken pastell som är vem.
 */
export const SHIFT_COLOR: Record<Shift, string> = {
  day: "var(--color-shift-day)",
  night: "var(--color-shift-night)",
};

/** Text intill rutan. Rutorna är fyllningar och duger inte till text. */
export const SHIFT_INK: Record<Shift, string> = {
  day: "var(--color-shift-day-ink)",
  night: "var(--color-shift-night-ink)",
};

export const SHIFT_LABEL: Record<Shift, string> = { day: "Dag", night: "Natt" };

/** Skiftets initial, brickan på ett pass utan riktning. */
export const SHIFT_INITIAL: Record<Shift, string> = { day: "D", night: "N" };

export const ABSENCE_ICON: Record<string, string> = {
  semester: "🏖",
  sjuk: "🤒",
  vab: "🧒",
  tjanstledig: "📄",
  foraldraledig: "🍼",
  kompledig: "⏱",
  ovrig: "•",
};
