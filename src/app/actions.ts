"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Sätter eller byter förare i en cell. */
export async function setAssignment(input: {
  boardRowId: string;
  date: string;
  slot: number;
  employeeId: string | null;
  vehicleId: string | null;
  note: string | null;
  boardSlug: string;
}): Promise<void> {
  const db = getDb();
  const { boardRowId, date, slot, employeeId, vehicleId, note } = input;

  const [existing] = await db
    .select()
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.boardRowId, boardRowId),
        eq(schema.assignment.date, date),
        eq(schema.assignment.slot, slot),
      ),
    );

  // En cell utan förare, bil och notering ska försvinna, inte ligga kvar tom.
  const isEmpty = !employeeId && !vehicleId && !note;

  if (existing && isEmpty) {
    await db.delete(schema.assignment).where(eq(schema.assignment.id, existing.id));
  } else if (existing) {
    await db
      .update(schema.assignment)
      .set({ employeeId, vehicleId, note, updatedAt: new Date() })
      .where(eq(schema.assignment.id, existing.id));
  } else if (!isEmpty) {
    await db
      .insert(schema.assignment)
      .values({ boardRowId, date, slot, employeeId, vehicleId, note });
  }

  revalidatePath(`/tavla/${input.boardSlug}`);
}

/** Tar bort en tilldelning helt. */
export async function clearAssignment(assignmentId: string, boardSlug: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.assignment).where(eq(schema.assignment.id, assignmentId));
  revalidatePath(`/tavla/${boardSlug}`);
}
