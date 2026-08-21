"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import { syncBaseData, type SyncResult } from "@/server/transpa-sync";

export async function runTranspaSync(): Promise<SyncResult> {
  await requireAdmin();
  const result = await syncBaseData();
  revalidatePath("/transpa");
  revalidatePath("/");
  return result;
}
