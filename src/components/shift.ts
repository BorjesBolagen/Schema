import type { Shift } from "@/lib/work-days";

/* Variantväljaren behövs — utan den ritas ☀ som en tunn asterisk. */
export const SHIFT_ICON: Record<Shift, string> = { day: "\u2600\ufe0f", night: "\u{1F319}" };

/**
 * Skiftets färg, samma i tavlan som i sidopanelen.
 *
 * Emojin duger i en cell men inte i en kolumn: ett ☀️ per skiftrad blev
 * sexton solar och månar i en smal spalt, och de drog till sig mer
 * uppmärksamhet än namnen de skulle märka upp. En liten färgruta säger
 * samma sak och håller sig i bakgrunden — och det är samma två kulörer
 * som veckoremsan i bemanningen, så de betyder samma sak överallt.
 */
export const SHIFT_COLOR: Record<Shift, string> = {
  day: "var(--color-shift-day)",
  night: "var(--color-shift-night)",
};
export const SHIFT_LABEL: Record<Shift, string> = { day: "Dag", night: "Natt" };

export const ABSENCE_ICON: Record<string, string> = {
  semester: "🏖",
  sjuk: "🤒",
  vab: "🧒",
  tjanstledig: "📄",
  foraldraledig: "🍼",
  kompledig: "⏱",
  ovrig: "•",
};
