import type { Shift } from "./work-days";

/** Skiftnamn utan ikon, för Excel och andra ställen där emoji inte passar. */
export const SHIFT_LABEL_PLAIN: Record<Shift, string> = { day: "Dag", night: "Natt" };
