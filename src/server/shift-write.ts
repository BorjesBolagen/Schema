import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import {
  TranspaClient,
  TranspaApiError,
  TranspaQuotaError,
} from "@/lib/transpa/client";
import {
  credentialsForTenant,
  SHIFT_READ_SCOPES,
  SHIFT_WRITE_SCOPES,
} from "@/lib/transpa/auth";
import {
  assertMayWriteTo,
  WriteNotAllowedError,
} from "@/lib/transpa/write-guard";
import {
  buildMovePayload,
  shiftDays,
  ShiftMoveError,
} from "@/lib/transpa/shift-move";
import {
  AdjustedWorkTimeError,
  CALCULATE_PATH,
  readAdjustedWorkTime,
} from "@/lib/transpa/adjusted-work-time";
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

/**
 * Kör ett anrop och namnger vilket det var om det faller.
 *
 * En flytt är två anrop mot samma URL — läs tillbaka, skriv — och de
 * misslyckas på olika sätt av olika skäl. Utan namnet är felet
 * "TransPA svarade 404 på /v1/shifts/abc" i båda fallen, och det säger
 * inte om passet saknas eller om skrivningen nekas.
 */
async function steg<T>(vad: string, gör: () => Promise<T>): Promise<T> {
  try {
    return await gör();
  } catch (error) {
    /* Kvoten är slut oavsett vilket steg som råkade upptäcka det.
       "vid skriva passet: kvoten är slut" pekar ut fel sak att laga. */
    if (error instanceof TranspaQuotaError) throw error;
    if (error instanceof TranspaApiError) {
      throw new TranspaApiError(
        `vid ${vad}: ${error.message}`,
        error.status,
        error.path,
        error.problem,
      );
    }
    throw error;
  }
}

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

  const namn = person
    ? `${person.firstName} ${person.lastName}`.trim()
    : "okänd person";

  /* Vad som faktiskt anropades, i tur och ordning.
     En flytt är tre anrop, och när ett faller säger felet bara något om
     det sista. Utan de andra gick det inte att se om uträkningen ens
     hade körts — precis den frågan blev obesvarbar när PUT:en svarade
     404 och loggen bara visade PUT-raden. */
  const spår: string[] = [];
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
      requestBody:
        requestBody === undefined
          ? null
          : JSON.stringify(requestBody).slice(0, MAX_RESPONSE),
      status,
      responseStatus,
      responseBody:
        [responseBody, spår.length ? `Anrop:\n${spår.join("\n")}` : null]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, MAX_RESPONSE) || null,
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
       till sitt gamla värde.

       Läs-scope till läsningen. Skriv-scopet bär inte läsrätt, och med
       det begärt svarade TransPA 403 med "Claim value mismatch:
       scope=transpaapi:shifts:read" — ett fel som pekade på läsning
       fast det var tokenbegäran som var fel. */
    spår.push(`GET ${path}`);
    const current = await steg("läsa tillbaka passet", () =>
      client.request<TranspaShift>(path, { scopes: SHIFT_READ_SCOPES }),
    );
    const body = buildMovePayload(current, shiftDays(input));

    /* Checksumman innan skrivningen. PUT /v1/shifts/{id} har checkSum
       som obligatorisk frågeparameter, och utan den svarar TransPA 404
       — "Resource not found" på ett pass som just hämtats utan problem.
       Värdet fås genom att skicka passet till calculateAdjustedWorkTime,
       som räknar fram arbetstiden och kvitterar den med en summa. */
    spår.push(`POST ${CALCULATE_PATH}`);
    const beräknad = await steg("räkna om arbetstiden", async () =>
      readAdjustedWorkTime(
        await client.post<unknown>(CALCULATE_PATH, body, { scopes: SHIFT_WRITE_SCOPES }),
      ),
    );

    /* Deras siffra, inte vår. adjustedWorkTimeInMinutes är arbetad tid,
       och hur rasterna räknas av beror på tenantens
       tidrapportinställningar. */
    const skickas =
      beräknad.adjustedWorkTimeInMinutes === undefined
        ? body
        : { ...body, adjustedWorkTimeInMinutes: beräknad.adjustedWorkTimeInMinutes };

    spår.push(
      `  → checkSum ${beräknad.checkSum}, minuter ${beräknad.adjustedWorkTimeInMinutes ?? "—"}`,
    );
    spår.push(`PUT ${path}?checkSum=${beräknad.checkSum}`);
    const response = await steg("skriva passet", () =>
      client.put<unknown>(path, skickas, {
        scopes: SHIFT_WRITE_SCOPES,
        query: { checkSum: beräknad.checkSum },
      }),
    );
    await spara(
      "ok",
      200,
      response === null ? null : JSON.stringify(response),
      skickas,
    );
    return { ok: true, message: `${summary}. Skickat till TransPA.` };
  } catch (error) {
    const message =
      error instanceof TranspaQuotaError
        ? error.message
        : error instanceof WriteNotAllowedError
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
  /* Sorteringen måste vara fallande *före* limit. Stigande sortering
     med limit plockar de äldsta raderna och vänder sedan på dem — så
     fort loggen har fler än limit rader visade den alltså de första
     skrivningarna någonsin i stället för de senaste, vilket är precis
     tvärtemot vad den som just fått ett fel behöver se. */
  return db
    .select()
    .from(schema.transpaOutbox)
    .orderBy(desc(schema.transpaOutbox.createdAt))
    .limit(limit);
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
