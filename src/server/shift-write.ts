import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { TranspaClient, TranspaApiError } from "@/lib/transpa/client";
import { credentialsForTenant, SHIFT_WRITE_SCOPES } from "@/lib/transpa/auth";
import { assertMayWriteTo, WriteNotAllowedError } from "@/lib/transpa/write-guard";
import { buildMovePayload, shiftDays, ShiftMoveError } from "@/lib/transpa/shift-move";
import type { TranspaShift } from "@/lib/transpa/shifts";

/**
 * Skickar en flytt av ett pass tillbaka till TransPA.
 *
 * Ordningen är medvetet den här: spärren först, sedan kroppen, sedan
 * nätet. Ett anrop mot en produktionstenant ska aldrig hinna byggas för
 * någon som inte får skrivas till.
 *
 * Passet hämtas färskt från TransPA innan det skrivs. Vår sparade kopia
 * är en tolkning och kan vara timmar gammal; PUT ersätter hela passet,
 * så ett fält som hunnit ändras i TransPA skulle skrivas tillbaka till
 * sitt gamla värde.
 */

export interface SendMoveResult {
  ok: boolean;
  /** Klartext om vad som hände, för planeraren. */
  message: string;
}

/** Så mycket av svaret som sparas. Ett helt felsvar kan vara långt. */
const MAX_RESPONSE = 2000;

export async function sendShiftMove(
  input: {
    employeeId: string;
    transpaShiftId: string;
    from: string;
    to: string;
    userId: string;
  },
  fetchImpl: typeof fetch = fetch,
  dbOverride?: Db,
): Promise<SendMoveResult> {
  const db = dbOverride ?? getDb();

  const [person] = await db
    .select({
      id: schema.employee.id,
      firstName: schema.employee.firstName,
      lastName: schema.employee.lastName,
      transpaId: schema.employee.transpaId,
      tenantId: schema.employee.transpaTenantId,
    })
    .from(schema.employee)
    .where(eq(schema.employee.id, input.employeeId));

  const namn = person ? `${person.firstName} ${person.lastName}`.trim() : "okänd person";
  const summary = `Flyttade pass för ${namn}: ${input.from} → ${input.to}`;
  const path = `/v1/shifts/${input.transpaShiftId}`;

  const spara = async (
    status: "ok" | "failed",
    responseStatus: number | null,
    responseBody: string | null,
    requestBody: unknown,
  ) => {
    await db.insert(schema.transpaOutbox).values({
      userId: input.userId,
      employeeId: person?.id ?? null,
      transpaShiftId: input.transpaShiftId,
      summary,
      method: "PUT",
      path,
      requestBody: requestBody === undefined ? null : JSON.stringify(requestBody).slice(0, MAX_RESPONSE),
      status,
      responseStatus,
      responseBody: responseBody?.slice(0, MAX_RESPONSE) ?? null,
    });
  };

  try {
    if (!person) throw new Error("Personen finns inte i registret.");
    if (!person.transpaId || !person.tenantId) {
      throw new Error(`${namn} är inte kopplad till TransPA.`);
    }

    /* Spärren först. Inget anrop ska hinna byggas för någon som inte
       får skrivas till. */
    assertMayWriteTo(person.transpaId);

    const [tenant] = await db
      .select({ tenantId: schema.transpaTenant.tenantId })
      .from(schema.transpaTenant)
      .where(eq(schema.transpaTenant.id, person.tenantId));
    const credentials = tenant ? credentialsForTenant(tenant.tenantId) : null;
    if (!credentials) throw new Error("TransPA-uppgifter saknas för bolaget.");

    const client = new TranspaClient({ credentials, fetchImpl });

    /* Färskt pass, inte vår kopia: PUT ersätter hela passet, så ett
       fält som hunnit ändras i TransPA skulle annars skrivas tillbaka
       till sitt gamla värde. */
    const current = await client.request<TranspaShift>(path, { scopes: SHIFT_WRITE_SCOPES });
    const body = buildMovePayload(current, shiftDays(input));

    const response = await client.put<unknown>(path, body, { scopes: SHIFT_WRITE_SCOPES });
    await spara("ok", 200, response === null ? null : JSON.stringify(response), body);
    return { ok: true, message: `${summary}. Skickat till TransPA.` };
  } catch (error) {
    const message =
      error instanceof WriteNotAllowedError
        ? error.message
        : error instanceof ShiftMoveError
          ? `Kunde inte bygga ändringen: ${error.message}`
          : error instanceof TranspaApiError
            ? `TransPA svarade ${error.status}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);

    await spara(
      "failed",
      error instanceof TranspaApiError ? error.status : null,
      message,
      undefined,
    );
    return { ok: false, message };
  }
}

/**
 * Skrivningarna som gjorts, senast först.
 *
 * Finns för att den som undrar varför ett pass flyttades ska kunna få
 * veta det utan att leta i en serverlogg.
 */
export async function recentWrites(limit = 20, dbOverride?: Db) {
  const db = dbOverride ?? getDb();
  const rows = await db
    .select()
    .from(schema.transpaOutbox)
    .orderBy(schema.transpaOutbox.createdAt)
    .limit(limit);
  return rows.reverse();
}

/** Vilka i en grupp som får skrivas till. Underlag för knappens läge. */
export async function writableEmployees(
  employeeIds: string[],
  dbOverride?: Db,
): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const db = dbOverride ?? getDb();
  const rows = await db
    .select({ id: schema.employee.id, transpaId: schema.employee.transpaId })
    .from(schema.employee)
    .where(inArray(schema.employee.id, employeeIds));

  const ut = new Set<string>();
  for (const r of rows) {
    try {
      assertMayWriteTo(r.transpaId);
      ut.add(r.id);
    } catch {
      /* inte skrivbar */
    }
  }
  return ut;
}
