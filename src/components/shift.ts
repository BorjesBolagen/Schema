import type { Shift } from "@/lib/work-days";

/* Variantväljaren behövs — utan den ritas ☀ som en tunn asterisk. */
export const SHIFT_ICON: Record<Shift, string> = { day: "\u2600\ufe0f", night: "\u{1F319}" };
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
