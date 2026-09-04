import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";

/**
 * Skriver om en ordning i en enda sats.
 *
 * Omordningarna gick tidigare rad för rad: en UPDATE per rad, i en
 * slinga, väntande på var och en. På en tavla med trettio rader blev
 * varje släpp trettio turer till databasen — och mot Supabase är turen
 * det som kostar, inte skrivningen. Det syntes som eftersläpning i
 * gränssnittet efter varje dragning.
 *
 * En sats i stället, med den nya ordningen som en VALUES-lista. Den
 * kostar en tur oavsett antal rader, och den är odelbar: antingen står
 * hela ordningen eller ingen del av den. Slingan kunde lämna halva
 * tavlan omflyttad om något föll på vägen.
 *
 * Tabell- och kolumnnamnen sätts av anroparen och interpoleras rakt in
 * — det är därför de är avgränsade till unionen nedan i stället för att
 * vara vilken sträng som helst. Id:na är däremot parametrar, som allt
 * annat som kommer utifrån.
 */
export type Sorteringstabell = "board_row" | "base_schedule";

export async function skrivOrdning(
  tabell: Sorteringstabell,
  idsIOrdning: string[],
  dbOverride?: Db,
): Promise<void> {
  if (idsIOrdning.length === 0) return;

  const värden = sql.join(
    idsIOrdning.map((id, i) => sql`(${id}::uuid, ${i}::int)`),
    sql`, `,
  );

  await (dbOverride ?? getDb()).execute(
    sql`update ${sql.raw(tabell)} as t
        set sort_order = v.ord
        from (values ${värden}) as v(id, ord)
        where t.id = v.id`,
  );
}
