import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as schema from "./schema";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

/**
 * Varje tabell måste ha Row Level Security påslaget.
 *
 * Supabase publicerar automatiskt ett REST-API för schemat public,
 * nåbart med anon-nyckeln — och den är avsedd att vara publik. Utan RLS
 * kan vem som helst som känner till projektets adress läsa och skriva.
 * Värst är session: den som kan skriva där lägger in en egen rad mot en
 * administratörs id och är inloggad som administratör.
 *
 * Appen påverkas inte, för den kopplar som tabellernas ägare och en
 * ägare går förbi RLS. Testet finns för att en ny tabell aldrig ska
 * hamna utanför skyddet utan att någon märker det.
 */
const tables = Object.values(schema)
  .filter((v) => is(v, PgTable))
  .map((t) => getTableName(t as PgTable))
  .sort();

const setupSql = readFileSync("docs/supabase-setup.sql", "utf8");

describe("Row Level Security", () => {
  it("hittar tabellerna i schemat", () => {
    expect(tables.length).toBeGreaterThan(10);
  });

  it("slår på RLS för varje tabell i uppsättnings-SQL:en", () => {
    const utan = tables.filter(
      (t) => !setupSql.includes(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`),
    );
    expect(utan).toEqual([]);
  });

  it("tvingar inte RLS på ägaren — då skulle appen sluta fungera", () => {
    // Bara riktiga satser: frasen står också i migrationens kommentar,
    // där den förklarar just varför den inte används.
    const satser = setupSql
      .split("\n")
      .filter((rad) => !rad.trimStart().startsWith("--"))
      .join("\n");
    expect(satser).not.toContain("FORCE ROW LEVEL SECURITY");
  });
});
