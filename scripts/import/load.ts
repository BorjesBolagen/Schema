import { eq, sql } from "drizzle-orm";
import type { Db } from "../../src/db/index";
import { schema } from "../../src/db/index";
import { aliasCandidates, normalizeAlias } from "../../src/lib/alias";
import type { PersonRecord } from "./personallista";
import type { ScheduleRow, WeekBlock } from "./parse-schema";
import { type AliasIndex, buildAliasIndex, resolveCellText, splitPair } from "./resolve";

const CHUNK = 500;

async function insertChunked<T>(rows: T[], run: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await run(rows.slice(i, i + CHUNK));
}

export interface PeopleResult {
  inserted: number;
  index: AliasIndex;
  ambiguous: Map<string, string[]>;
}

/** Skriver Personallista till employee + employee_alias och bygger uppslaget. */
export async function loadPeople(db: Db, records: PersonRecord[]): Promise<PeopleResult> {
  const values = records.map((p) => ({
    employeeNumber: p.employeeNumber,
    firstName: p.firstName,
    lastName: p.lastName,
    signature: p.signature,
    isActive: p.isActive,
    trafficAreaText: p.trafficAreaText,
    stationPlaceText: p.stationPlaceText,
    vacationGroup: p.vacationGroup,
    workGroup: p.workGroup,
    supervisor: p.supervisor,
    email: p.email,
    phone: p.phone,
  }));

  const inserted: Array<{ id: string; employeeNumber: string | null }> = [];
  await insertChunked(values, async (chunk) => {
    const got = await db
      .insert(schema.employee)
      .values(chunk)
      .onConflictDoNothing({ target: schema.employee.employeeNumber })
      .returning({ id: schema.employee.id, employeeNumber: schema.employee.employeeNumber });
    inserted.push(...got);
  });

  const byNumber = new Map(inserted.map((e) => [e.employeeNumber ?? "", e.id]));
  const people = records
    .map((p) => {
      const id = byNumber.get(p.employeeNumber ?? "");
      return id ? { id, candidates: aliasCandidates(p), record: p } : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const { index, ambiguous } = buildAliasIndex(people);

  // Bara entydiga smeknamn skrivs som globala alias. De tvetydiga
  // hamnar i granskningen och kopplas per tavla av en människa.
  const aliasRows = people.flatMap((p) =>
    p.candidates
      .filter((c) => index.get(normalizeAlias(c)) === p.id)
      .map((c) => ({
        employeeId: p.id,
        alias: c,
        aliasNormalized: normalizeAlias(c),
        source: "excel" as const,
      })),
  );
  await insertChunked(aliasRows, (chunk) =>
    db.insert(schema.employeeAlias).values(chunk).onConflictDoNothing(),
  );

  return { inserted: inserted.length, index, ambiguous };
}

/* ------------------------------------------------------------------ */

interface DerivedRow {
  key: string;
  label: string;
  sublabel: string | null;
  sortOrder: number;
}

/**
 * Slår ihop radetiketterna från alla veckor till tavlans raduppsättning.
 *
 * Etiketten ensam räcker som identitet utom när samma etikett
 * förekommer flera gånger i samma vecka — "Dahl" står på fyra rader med
 * bilnumret i andra kolumnen. Då ingår underetiketten i identiteten.
 */
export function deriveRows(
  blocks: WeekBlock[],
  pick: (b: WeekBlock) => ScheduleRow[],
): DerivedRow[] {
  const repeatsSomewhere = new Set<string>();
  for (const b of blocks) {
    const seen = new Set<string>();
    for (const r of pick(b)) {
      if (r.slot !== 0) continue;
      if (seen.has(r.label)) repeatsSomewhere.add(r.label);
      seen.add(r.label);
    }
  }

  const order = new Map<string, number>();
  const sublabels = new Map<string, Map<string, number>>();
  const labels = new Map<string, string>();
  let n = 0;

  for (const b of blocks) {
    for (const r of pick(b)) {
      const key = repeatsSomewhere.has(r.label) ? `${r.label}|${r.sublabel ?? ""}` : r.label;
      if (!order.has(key)) {
        order.set(key, n++);
        labels.set(key, r.label);
      }
      if (r.sublabel) {
        const counts = sublabels.get(key) ?? new Map<string, number>();
        counts.set(r.sublabel, (counts.get(r.sublabel) ?? 0) + 1);
        sublabels.set(key, counts);
      }
    }
  }

  return [...order.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key, sortOrder]) => {
      const counts = sublabels.get(key);
      const sublabel = counts
        ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;
      return { key, label: labels.get(key)!, sublabel, sortOrder };
    });
}

export function rowKeyOf(
  label: string,
  sublabel: string | null,
  derived: DerivedRow[],
): string | null {
  const withSub = `${label}|${sublabel ?? ""}`;
  if (derived.some((d) => d.key === withSub)) return withSub;
  if (derived.some((d) => d.key === label)) return label;
  return null;
}

export interface BoardImportStats {
  boardId: string;
  rows: number;
  assignments: number;
  resolved: number;
  notes: number;
  unresolved: number;
  absences: number;
}

export async function loadScheduleBoard(
  db: Db,
  opts: {
    name: string;
    slug: string;
    visibleWeekdays: number[];
    weekStartsOn: number;
    cellFields: string[];
    blocks: WeekBlock[];
    pick: (b: WeekBlock) => ScheduleRow[];
    index: AliasIndex;
    /** Semesterrutan hör till fjärrblocket och importeras bara en gång. */
    importAbsences: boolean;
  },
): Promise<BoardImportStats> {
  const [board] = await db
    .insert(schema.board)
    .values({
      name: opts.name,
      slug: opts.slug,
      visibleWeekdays: opts.visibleWeekdays,
      weekStartsOn: opts.weekStartsOn,
      cellFields: opts.cellFields,
    })
    .returning();

  const derived = deriveRows(opts.blocks, opts.pick);
  const rowIds = new Map<string, string>();
  await insertChunked(derived, async (chunk) => {
    const got = await db
      .insert(schema.boardRow)
      .values(
        chunk.map((d) => ({
          boardId: board.id,
          label: d.label,
          sublabel: d.sublabel,
          sortOrder: d.sortOrder,
        })),
      )
      .returning({ id: schema.boardRow.id, sortOrder: schema.boardRow.sortOrder });
    for (const g of got) {
      const d = chunk.find((x) => x.sortOrder === g.sortOrder)!;
      rowIds.set(d.key, g.id);
    }
  });

  const assignments: Array<typeof schema.assignment.$inferInsert> = [];
  /** Första och sista datum varje rad faktiskt användes. */
  const activeSpan = new Map<string, { from: string; to: string }>();
  const unresolved = new Map<string, { alias: string; count: number; sampleDate: string }>();
  const usedSlots = new Map<string, number>();
  let resolved = 0;
  let notes = 0;

  for (const block of opts.blocks) {
    for (const row of opts.pick(block)) {
      const key = rowKeyOf(row.label, row.sublabel, derived);
      const boardRowId = key ? rowIds.get(key) : undefined;
      if (!boardRowId) continue;

      for (const cell of row.cells) {
        const span = activeSpan.get(boardRowId);
        activeSpan.set(boardRowId, {
          from: span && span.from < cell.date ? span.from : cell.date,
          to: span && span.to > cell.date ? span.to : cell.date,
        });

        // En delad tur blir två tilldelningar på samma cell.
        for (const part of splitPair(cell.text) ?? [cell.text]) {
          const r = resolveCellText(part, opts.index);
          const cellKey = `${boardRowId}|${cell.date}`;
          const slot = usedSlots.get(cellKey) ?? 0;
          usedSlots.set(cellKey, slot + 1);

          if (r.kind === "employee") {
            resolved++;
            assignments.push({
              boardRowId,
              date: cell.date,
              slot,
              employeeId: r.employeeId,
              note: r.note,
            });
          } else if (r.kind === "unresolved") {
            const k = normalizeAlias(r.alias);
            const prev = unresolved.get(k);
            unresolved.set(k, {
              alias: r.alias,
              count: (prev?.count ?? 0) + 1,
              sampleDate: prev?.sampleDate ?? cell.date,
            });
            assignments.push({ boardRowId, date: cell.date, slot, note: r.note });
          } else {
            notes++;
            assignments.push({ boardRowId, date: cell.date, slot, note: r.note });
          }
        }
      }
    }
  }

  await insertChunked(assignments, (chunk) =>
    db.insert(schema.assignment).values(chunk).onConflictDoNothing(),
  );

  // Rader gäller från första till sista dagen de användes. Utan det
  // larmar en linje som bara gick under 2026 som obemannad hela 2025.
  for (const [rowId, span] of activeSpan) {
    await db
      .update(schema.boardRow)
      .set({ validFrom: span.from, validTo: span.to })
      .where(eq(schema.boardRow.id, rowId));
  }

  let absenceCount = 0;
  if (opts.importAbsences) {
    const seen = new Set<string>();
    const rows: Array<typeof schema.absence.$inferInsert> = [];
    for (const block of opts.blocks) {
      for (const a of block.absences) {
        const hit = opts.index.get(normalizeAlias(a.alias));
        if (!hit) {
          const k = normalizeAlias(a.alias);
          const prev = unresolved.get(k);
          unresolved.set(k, {
            alias: a.alias,
            count: (prev?.count ?? 0) + 1,
            sampleDate: prev?.sampleDate ?? a.fromDate,
          });
          continue;
        }
        const key = `${hit}|${a.fromDate}|${a.toDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          employeeId: hit,
          fromDate: a.fromDate,
          toDate: a.toDate,
          type: "semester",
          status: "approved",
          note: a.raw,
        });
      }
    }
    await insertChunked(rows, (chunk) => db.insert(schema.absence).values(chunk));
    absenceCount = rows.length;
  }

  const unresolvedRows = [...unresolved.entries()].map(([norm, v]) => ({
    alias: v.alias,
    aliasNormalized: norm,
    boardId: board.id,
    occurrences: v.count,
    sampleDate: v.sampleDate,
  }));
  await insertChunked(unresolvedRows, (chunk) =>
    db
      .insert(schema.unresolvedAlias)
      .values(chunk)
      .onConflictDoUpdate({
        target: [schema.unresolvedAlias.aliasNormalized, schema.unresolvedAlias.boardId],
        set: { occurrences: sql`${schema.unresolvedAlias.occurrences} + excluded.occurrences` },
      }),
  );

  return {
    boardId: board.id,
    rows: derived.length,
    assignments: assignments.length,
    resolved,
    notes,
    unresolved: unresolvedRows.length,
    absences: absenceCount,
  };
}
