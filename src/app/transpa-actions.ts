"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { syncBaseData, type SyncResult } from "@/server/transpa-sync";
import { lookupShifts, type ShiftLookupResult } from "@/server/shift-lookup";

export async function runTranspaSync(): Promise<SyncResult> {
  await requireAdmin();
  const result = await syncBaseData();
  revalidatePath("/transpa");
  revalidatePath("/");
  return result;
}

/**
 * Slår upp en persons pass i TransPA.
 *
 * Bakom requireAdmin: uppslaget visar en namngiven persons arbetstider,
 * och det är inget en planerare på en annan tavla ska kunna bläddra i.
 */
export async function lookupShiftsAction(input: {
  person: string;
  from: string;
  to: string;
}): Promise<ShiftLookupResult> {
  await requireAdmin();
  return lookupShifts(input);
}
