"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/server/auth";
import { requireBoardBySlug } from "@/server/access";
import { addDays, weekSpan } from "@/lib/week";
import { detectMoves, type ScheduleMove } from "@/lib/schedule-diff";
import { workDayFromStored } from "@/lib/transpa/shifts";
import { sendShiftMove, writableEmployees } from "@/server/shift-write";

/**
 * Skicka schemaändring till TransPA.
 *
 * Två steg med flit: först räknas ändringarna fram och visas, sedan
 * skickas de. TransPA-tenanten är produktionsmiljö, och den som trycker
 * ska se exakt vad som lämnar huset — inte "är du säker?" utan "tre pass
 * för Prov Provsson flyttas från onsdag till torsdag".
 */

export interface PendingChange extends ScheduleMove {
  name: string;
  /** Falskt när personen inte står på skrivningens tillåtelselista. */
  writable: boolean;
}

export interface PendingChanges {
  moves: PendingChange[];
  /** Dagar på tavlan som inte motsvarar ett pass i TransPA. */
  added: number;
  /** Pass i TransPA som ingen står på. */
  removed: number;
}

async function collect(boardSlug: string, year: number, week: number) {
  const user = await requireUser();
  const board = await requireBoardBySlug(user, boardSlug);
  const db = getDb();
  const { from, to } = weekSpan(year, week, board.weekStartsOn);

  const crew = await db
    .select({ employeeId: schema.boardCrew.employeeId })
    .from(schema.boardCrew)
    .where(eq(schema.boardCrew.boardId, board.id));
  const ids = crew.map((c) => c.employeeId);
  if (ids.length === 0) return { user, board, from, to, ids, placed: [], planned: [], db };

  const rows = await db
    .select({ id: schema.boardRow.id })
    .from(schema.boardRow)
    .where(eq(schema.boardRow.boardId, board.id));

  const placed = rows.length
    ? await db
        .select({
          employeeId: schema.assignment.employeeId,
          date: schema.assignment.date,
          shift: schema.assignment.shift,
        })
        .from(schema.assignment)
        .where(
          and(
            inArray(
              schema.assignment.boardRowId,
              rows.map((r) => r.id),
            ),
            gte(schema.assignment.date, from),
            lte(schema.assignment.date, to),
          ),
        )
    : [];

  /* Passen tolkas om vid läsning, precis som överallt annars — den
     sparade dagen är en gammal tolkning. Därför marginal på filtret. */
  const lagrade = await db
    .select({
      transpaId: schema.transpaShift.transpaId,
      employeeId: schema.transpaShift.employeeId,
      startsAt: schema.transpaShift.startsAt,
      endsAt: schema.transpaShift.endsAt,
      workMinutes: schema.transpaShift.workMinutes,
    })
    .from(schema.transpaShift)
    .where(
      and(
        inArray(schema.transpaShift.employeeId, ids),
        gte(schema.transpaShift.date, addDays(from, -1)),
        lte(schema.transpaShift.date, addDays(to, 1)),
      ),
    );

  const planned = lagrade
    .map((r) => ({ ...workDayFromStored(r), transpaId: r.transpaId }))
    .filter((p) => p.date >= from && p.date <= to);

  return {
    user,
    board,
    from,
    to,
    ids,
    db,
    placed: placed
      .filter((p): p is typeof p & { employeeId: string } => p.employeeId !== null)
      .map((p) => ({ employeeId: p.employeeId, date: p.date, shift: p.shift })),
    planned,
  };
}

/** Vad som skulle skickas, utan att skicka något. */
export async function pendingChanges(input: {
  boardSlug: string;
  year: number;
  week: number;
}): Promise<PendingChanges> {
  const { placed, planned, ids, db } = await collect(input.boardSlug, input.year, input.week);
  const diff = detectMoves({ placed, planned });

  const skrivbara = await writableEmployees(ids);
  const namn = new Map(
    (
      await db
        .select({
          id: schema.employee.id,
          firstName: schema.employee.firstName,
          lastName: schema.employee.lastName,
        })
        .from(schema.employee)
        .where(inArray(schema.employee.id, ids.length ? ids : ["-"]))
    ).map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]),
  );

  return {
    moves: diff.moves.map((m) => ({
      ...m,
      name: namn.get(m.employeeId) ?? "Okänd",
      writable: skrivbara.has(m.employeeId),
    })),
    added: diff.added.length,
    removed: diff.removed.length,
  };
}

export interface SendResult {
  sent: number;
  failed: number;
  messages: string[];
}

/**
 * Skickar ändringarna.
 *
 * Räknas fram på nytt här och tas inte emot från klienten: det som
 * bekräftades kan ha hunnit ändras, och en lista skickad utifrån vore
 * en väg att be servern skriva vad som helst till TransPA.
 */
export async function sendPendingChanges(input: {
  boardSlug: string;
  year: number;
  week: number;
}): Promise<SendResult> {
  const { placed, planned, user } = await collect(input.boardSlug, input.year, input.week);
  const { moves } = detectMoves({ placed, planned });

  const messages: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const m of moves) {
    const result = await sendShiftMove({
      employeeId: m.employeeId,
      transpaShiftId: m.transpaId,
      from: m.from,
      to: m.to,
      userId: user.id,
    });
    if (result.ok) sent++;
    else failed++;
    messages.push(result.message);
  }

  revalidatePath(`/tavla/${input.boardSlug}`);
  return { sent, failed, messages };
}
