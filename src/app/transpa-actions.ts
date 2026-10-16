"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/server/auth";
import {
  importNewEmployees,
  syncBaseData,
  type ImportNewResult,
  type SyncResult,
} from "@/server/transpa-sync";
import { lookupShifts, type ShiftLookupResult } from "@/server/shift-lookup";

export async function runTranspaSync(): Promise<SyncResult> {
  await requireAdmin();
  const result = await syncBaseData();
  revalidatePath("/transpa");
  revalidatePath("/");
  return result;
}

/**
 * Hämtar personer som tillkommit i TransPA.
 *
 * Öppen för planerare, till skillnad från den fulla synken: den lägger
 * bara till, och den som får lägga upp en person för hand under
 * Grunddata ska också få hämta henne från TransPA.
 */
export async function importNewEmployeesAction(): Promise<ImportNewResult> {
  await requireUser();
  const result = await importNewEmployees();
  revalidatePath("/grunddata");
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
