"use server";

import { revalidatePath } from "next/cache";
import { currentSessionHash, requireAdmin, requireUser } from "@/server/auth";
import {
  changeOwnPassword as bytEgetLösenord,
  createUser,
  otherActiveAdmins,
  setActive,
  setBoardAccess,
  setPassword,
  type UserResult,
} from "@/server/users";

const refresh = () => revalidatePath("/anvandare");

export async function addUser(input: {
  email: string;
  name: string;
  role: "admin" | "planner";
  password: string;
  boardIds: string[];
}): Promise<UserResult> {
  await requireAdmin();
  const result = await createUser(input);
  refresh();
  return result;
}

export async function changeUserPassword(userId: string, password: string): Promise<UserResult> {
  await requireAdmin();
  const result = await setPassword(userId, password);
  refresh();
  return result;
}

/**
 * Byter sitt eget lösenord.
 *
 * Det nuvarande krävs — se changeOwnPassword i users.ts. Den egna
 * sessionen skonas, alla andra rivs: byter man lösenord för att någon
 * annan kan ha kommit över det hjälper det inte om den sitter kvar på
 * en giltig kaka i trettio dagar.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<UserResult> {
  const user = await requireUser();
  const result = await bytEgetLösenord(
    user.id,
    currentPassword,
    newPassword,
    await currentSessionHash(),
  );
  revalidatePath("/konto");
  return result;
}

export async function updateBoardAccess(userId: string, boardIds: string[]): Promise<void> {
  await requireAdmin();
  await setBoardAccess(userId, boardIds);
  refresh();
}

/**
 * Stänger av eller aktiverar ett konto.
 *
 * Den sista aktiva administratören går inte att stänga av — annars går
 * det inte längre att komma åt användarhanteringen alls.
 */
export async function toggleUserActive(userId: string, isActive: boolean): Promise<UserResult> {
  const me = await requireAdmin();
  if (!isActive && (await otherActiveAdmins(userId)) === 0) {
    return { ok: false, error: "Det måste finnas minst en aktiv administratör." };
  }
  if (!isActive && userId === me.id) {
    return { ok: false, error: "Du kan inte stänga av ditt eget konto." };
  }
  await setActive(userId, isActive);
  refresh();
  return { ok: true };
}
