import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { weekSpan } from "@/lib/week";

/**
 * Veckans läge per tavla, för förstasidan.
 *
 * Sidan var en meny: namnen och inget mer. Den som öppnar verktyget vill
 * veta var något behöver göras, inte bara vart man kan gå.
 *
 * Siffrorna är medvetet sådana som går att räkna i databasen utan att
 * tolka något. "Ej utlagda" — den som jobbar men saknar bil — vore det
 * mest användbara talet, men det kräver samma omtolkning av passens
 * tider som tavlan gör i TypeScript. Räknat en gång till i SQL vore det
 * en andra sanning som kan säga emot den första, och de motsägelserna
 * har kostat nog med tid i det här projektet. Det talet hör hemma här
 * först när logiken går att dela.
 */

export interface BoardOverview {
  boardId: string;
  /** Personer i bemanningen. */
  crew: number;
  /** Rader på tavlan. */
  rows: number;
  /** Utlagda pass under den vecka tavlan visar. */
  assignments: number;
  /** Personer i bemanningen som är frånvarande någon dag i veckan. */
  absent: number;
}

/**
 * Ett anrop för alla tavlor, inte ett per tavla.
 *
 * Veckans spann skiljer sig mellan tavlor — en som börjar på söndag har
 * andra datum än en som börjar på måndag — så spannen räknas här och
 * skickas in som en tabell. Alternativet, en fråga per tavla, ger tio
 * anrop för tio tavlor på en sida som ska öppnas ofta.
 */
export async function boardOverviews(
  boards: Array<{ id: string; weekStartsOn: number }>,
  year: number,
  week: number,
  dbOverride?: Db,
): Promise<Map<string, BoardOverview>> {
  if (boards.length === 0) return new Map();
  const db = dbOverride ?? getDb();

  const spann = boards.map((b) => {
    const { from, to } = weekSpan(year, week, b.weekStartsOn);
    return sql`(${b.id}::uuid, ${from}::date, ${to}::date)`;
  });

  const rows = await db.execute<{
    board_id: string;
    crew: number;
    rows: number;
    assignments: number;
    absent: number;
  }>(sql`
    with spann (board_id, fran, till) as (values ${sql.join(spann, sql`, `)})
    select
      s.board_id,
      (select count(*)::int from board_crew c where c.board_id = s.board_id) as crew,
      (select count(*)::int from board_row r where r.board_id = s.board_id) as rows,
      (select count(*)::int
         from assignment a
         join board_row r on r.id = a.board_row_id
        where r.board_id = s.board_id
          and a.date between s.fran and s.till) as assignments,
      (select count(distinct c.employee_id)::int
         from board_crew c
         join absence ab on ab.employee_id = c.employee_id
        where c.board_id = s.board_id
          and ab.from_date <= s.till
          and ab.to_date >= s.fran) as absent
    from spann s
  `);

  /* postgres-js ger en array, PGlite ett objekt med rows. */
  const list = Array.isArray(rows)
    ? rows
    : ((rows as { rows: Array<Record<string, unknown>> }).rows ?? []);

  return new Map(
    list.map((r) => {
      const x = r as unknown as {
        board_id: string;
        crew: number;
        rows: number;
        assignments: number;
        absent: number;
      };
      return [
        x.board_id,
        {
          boardId: x.board_id,
          crew: Number(x.crew),
          rows: Number(x.rows),
          assignments: Number(x.assignments),
          absent: Number(x.absent),
        },
      ];
    }),
  );
}

/** När grunddata senast hämtades från TransPA, eller null om aldrig. */
export async function lastSync(dbOverride?: Db): Promise<Date | null> {
  const db = dbOverride ?? getDb();
  const rows = await db.execute<{ finished_at: string | Date | null }>(sql`
    select max(finished_at) as finished_at from sync_run where status = 'ok'
  `);
  const list = Array.isArray(rows)
    ? rows
    : ((rows as { rows: Array<Record<string, unknown>> }).rows ?? []);
  const v = (list[0] as { finished_at?: string | Date | null } | undefined)?.finished_at;
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}
