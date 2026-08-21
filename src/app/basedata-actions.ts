"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/server/auth";
import { createBoard, deleteBoard, type BoardResult, type BoardTemplate } from "@/server/boards";
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
