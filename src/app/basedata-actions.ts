"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import {
  boardRemovalFacts,
  createBoard,
  deleteBoard,
  type BoardRemovalFacts,
  type BoardResult,
  type BoardTemplate,
} from "@/server/boards";
import { boardForActionById } from "@/server/access";
import {
  addEmployee,
  addStation,
  addVehicle,
  removeStation,
  renameStation,
  setStationPlaceForEmployees,
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
  const user = await requireUser();
  await boardForActionById(user, boardId);
  return boardRemovalFacts(boardId);
}

/**
 * Tar bort en tavla.
 *
 * Var admin-bara med skälet "en planerare ska inte kunna radera en
 * kollegas tavla". Skälet höll, men medlet var för trubbigt: det
 * hindrade också planeraren från att ta bort sin *egen*, och den som
 * får bygga en tavla ska få riva den igen.
 *
 * Rätt gräns är ändringsrätt på just den tavlan, inte rollen. Den som
 * inte är medlem når den ändå inte — och den som bara får läsa får inte
 * radera.
 */
export async function removeBoard(boardId: string): Promise<void> {
  const user = await requireUser();
  await boardForActionById(user, boardId);
  await deleteBoard(boardId);
  revalidatePath("/");
}

/* ------------------------------------------------------------------ *
 * Grunddata
 * ------------------------------------------------------------------ */

export async function createStation(name: string): Promise<BaseDataResult> {
  await requireUser();
  const result = await addStation(name);
  refresh();
  return result;
}

export async function editStation(id: string, name: string): Promise<BaseDataResult> {
  await requireUser();
  const result = await renameStation(id, name);
  refresh();
  return result;
}

export async function deleteStation(id: string): Promise<BaseDataResult> {
  await requireUser();
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
  await requireUser();
  const result = await addEmployee(input);
  refresh();
  return result;
}

export async function editEmployee(
  id: string,
  patch: { firstName?: string; lastName?: string; stationPlaceId?: string | null; isActive?: boolean },
): Promise<BaseDataResult> {
  await requireUser();
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
  await requireUser();
  const result = await setStationPlaceForEmployees(employeeIds, stationPlaceId);
  refresh();
  return result;
}

export async function createVehicle(input: {
  displayName: string;
  registrationNumber?: string;
  stationPlaceId?: string | null;
}): Promise<BaseDataResult> {
  await requireUser();
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
  await requireUser();
  const result = await updateVehicle(id, patch);
  refresh();
  return result;
}
