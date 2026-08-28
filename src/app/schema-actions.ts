"use server";

import { pendingMigrations } from "@/server/schema-guard";

/**
 * Ligger databasen efter koden?
 *
 * Anropas av felgränsen. Next döljer felmeddelandet i drift och lämnar
 * bara en digest, så gränsen kan inte läsa sig till *varför* något gick
 * sönder — den får fråga i stället.
 *
 * Ingen behörighetskontroll: svaret är namnen på migrationsfilerna i
 * repot, som inte säger något om verksamheten, och den som ser
 * felgränsen har redan en trasig sida framför sig.
 */
export async function schemaBehind(): Promise<string[]> {
  const { ok, pending } = await pendingMigrations();
  return ok ? pending : [];
}
