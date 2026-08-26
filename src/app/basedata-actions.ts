"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/server/auth";
import { writePattern, type PatternDayInput } from "@/server/patterns";
import {
  boardRemovalFacts,
  createBoard,
  deleteBoard,
  type BoardRemovalFacts,
  type BoardResult,
  type BoardTemplate,
} from "@/server/boards";
import { requireBoardById } from "@/server/access";
import {
  addEmployee,
  addStation,
  addVehicle,
  removeStation,
  renameStation,
  updateEmployee,
  updateVehicle,
  type BaseDataResult,
} from "@/server/basedata";

const refresh = () => revalidatePath("/grunddata");

/* ------------------------------------------------------------------ *
 * Tavlor
 * ------------------------------------------------------------------ */

export async function addBoard(input: { name: string; template: BoardTemplate }): Promise<BoardResult> {
  const user = await requireUser();
  const result = await createBoard(user, input);
  if (result.ok) revalidatePath("/");
  return result;
}

/** Vad en borttagning skulle ta med sig — underlag för bekräftelsen. */
export async function boardRemovalPreview(boardId: string): Promise<BoardRemovalFacts> {
  const user = await requireAdmin();
  await requireBoardById(user, boardId);
  return boardRemovalFacts(boardId);
}

/** Endast admin. En planerare ska inte kunna radera en kollegas tavla. */
export async function removeBoard(boardId: string): Promise<void> {
  const user = await requireAdmin();
  await requireBoardById(user, boardId);
  await deleteBoard(boardId);
  revalidatePath("/");
}

/* ------------------------------------------------------------------ *
 * Grunddata
 * ------------------------------------------------------------------ */

export async function createStation(name: string): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await addStation(name);
  refresh();
  return result;
}

export async function editStation(id: string, name: string): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await renameStation(id, name);
  refresh();
  return result;
}

export async function deleteStation(id: string): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await removeStation(id);
  refresh();
  return result;
}

export async function createEmployee(input: {
  firstName: string;
  lastName: string;
  employeeNumber?: string;
  stationPlaceId?: string | null;
}): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await addEmployee(input);
  refresh();
  return result;
}

export async function editEmployee(
  id: string,
  patch: { firstName?: string; lastName?: string; stationPlaceId?: string | null; isActive?: boolean },
): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await updateEmployee(id, patch);
  refresh();
  return result;
}

/**
 * Sätter stationsort på flera personer i ett svep.
 *
 * TransPA:s Employee bär ingen stationsort — den ägs här. Med flera
 * hundra personer i registret är en rullgardin per rad ingen väg fram;
 * det är den här som gör kopplingen görbar över huvud taget.
 */
export async function setStationPlaceForMany(
  employeeIds: string[],
  stationPlaceId: string | null,
): Promise<BaseDataResult> {
  await requireAdmin();
  for (const id of employeeIds) {
    const result = await updateEmployee(id, { stationPlaceId });
    // Faller en rad avbryts hela ändringen — hellre ett tydligt fel än
    // en halvt genomförd massättning som ingen ser.
    if (!result.ok) return result;
  }
  refresh();
  return { ok: true };
}

/**
 * Lägger samma arbetsmönster på flera personer.
 *
 * Mönstren är enda källan till arbetsdagar — TransPA har varken pass,
 * frånvaro eller semester att hämta, och turerna är för glesa för att
 * bära ett veckomönster. Med 301 personer i registret är ett mönster i
 * taget inte en väg fram, och nästan alla kör måndag till fredag dagtid.
 *
 * Skriver över befintliga mönster för de valda. Det är avsikten: den
 * som markerar trettio personer och sätter mån–fre menar det. Urvalet
 * görs i listan, där det syns vilka som träffas.
 */
export async function setWorkPatternForMany(
  employeeIds: string[],
  input: { cycleWeeks: number; anchorDate: string; weekStartsOn: number; days: PatternDayInput[] },
): Promise<BaseDataResult> {
  await requireAdmin();
  for (const id of employeeIds) await writePattern(id, input);
  refresh();
  return { ok: true };
}

export async function createVehicle(input: {
  displayName: string;
  registrationNumber?: string;
  stationPlaceId?: string | null;
}): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await addVehicle(input);
  refresh();
  return result;
}

export async function editVehicle(
  id: string,
  patch: {
    displayName?: string;
    registrationNumber?: string | null;
    stationPlaceId?: string | null;
    isActive?: boolean;
  },
): Promise<BaseDataResult> {
  await requireAdmin();
  const result = await updateVehicle(id, patch);
  refresh();
  return result;
}
