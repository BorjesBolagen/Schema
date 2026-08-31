import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import type { Db } from "./index";
import { assertRightProject, verdict, WrongProjectError } from "./project-guard";

/**
 * Vakten mot fel databas, den programmatiska vägen.
 *
 * docs/supabase-setup.sql har sin egen vakt i SQL. Den här är samma
 * regel för npm run db:migrate, där felet ser annorlunda ut men blir
 * lika dyrt: en bortglömd DATABASE_URL i skalet skriver tjugo tabeller
 * i fel Supabase-projekt utan att någonting säger ifrån.
 */

const dbFor = (pg: PGlite) => drizzle(pg) as unknown as Db;

describe("verdict", () => {
  it("släpper igenom en tom databas — det är en förstagångsuppsättning", () => {
    expect(verdict({ hasMark: false, markIsOurs: false, tables: 0, ourOldest: 0 }).ok).toBe(true);
  });

  it("släpper igenom vår databas med märket", () => {
    expect(verdict({ hasMark: true, markIsOurs: true, tables: 20, ourOldest: 3 }).ok).toBe(true);
  });

  /* Databaser vi migrerade innan 0010 fanns saknar märket. De är våra,
     och att låsa ute oss själva vore värre än att inte ha någon vakt. */
  it("släpper igenom vår databas från före märket", () => {
    expect(verdict({ hasMark: false, markIsOurs: false, tables: 20, ourOldest: 3 }).ok).toBe(true);
  });

  it("stoppar en främmande databas med tabeller", () => {
    expect(verdict({ hasMark: false, markIsOurs: false, tables: 7, ourOldest: 0 }).ok).toBe(false);
  });

  /* Namnkrock: tabellen finns men säger någon annans namn. */
  it("stoppar när märket tillhör en annan app", () => {
    const v = verdict({ hasMark: true, markIsOurs: false, tables: 20, ourOldest: 3 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/annan app/);
  });
});

describe("assertRightProject", () => {
  it("släpper igenom en tom databas", async () => {
    const pg = new PGlite();
    await expect(assertRightProject(dbFor(pg))).resolves.toBeUndefined();
    await pg.close();
  });

  it("släpper igenom databasen uppsättningsfilen just skapat", async () => {
    const pg = new PGlite();
    await pg.exec(await readFile("docs/supabase-setup.sql", "utf8"));
    await expect(assertRightProject(dbFor(pg))).resolves.toBeUndefined();
    await pg.close();
  });

  it("vägrar mot någon annans databas", async () => {
    const pg = new PGlite();
    await pg.exec("create table fakturor (id serial primary key)");
    await expect(assertRightProject(dbFor(pg))).rejects.toThrow(WrongProjectError);
    await pg.close();
  });

  it("vägrar när märket tillhör en annan app", async () => {
    const pg = new PGlite();
    await pg.exec("create table schema_app_identity (app text primary key)");
    await pg.exec("insert into schema_app_identity (app) values ('nagon-annans-app')");
    await expect(assertRightProject(dbFor(pg))).rejects.toThrow(/annan app/);
    await pg.close();
  });
});
