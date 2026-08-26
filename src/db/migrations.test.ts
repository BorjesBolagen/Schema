import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Drizzle kör inte migrationerna som ligger i katalogen — den kör dem
 * som står i journalen. En handskriven .sql-fil som inte registrerats
 * hoppas därför tyst över: schemat blir kvar som det var, och felet
 * dyker upp först som "column ... does not exist" långt senare.
 *
 * Det hände med 0003_profession_group. Testet finns för att det inte
 * ska hända igen.
 */
const FOLDER = new URL("../../drizzle/", import.meta.url);

const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", FOLDER), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

const files = readdirSync(FOLDER)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

describe("migrationer", () => {
  it("har varje sql-fil registrerad i journalen", () => {
    const registered = new Set(journal.entries.map((e) => e.tag));
    expect(files.filter((f) => !registered.has(f))).toEqual([]);
  });

  it("pekar inte på en fil som inte finns", () => {
    const present = new Set(files);
    expect(journal.entries.map((e) => e.tag).filter((t) => !present.has(t))).toEqual([]);
  });

  it("numrerar löpande, så ordningen är entydig", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  /**
   * Drizzle skickar en migration som en enda sats. Utan brytpunkter
   * faller en fil med flera kommandon på "cannot insert multiple
   * commands into a prepared statement" — vilket 0002_rls gjorde.
   */
  it("delar flerkommandofiler med statement-breakpoint", () => {
    for (const tag of files) {
      const sql = readFileSync(new URL(`${tag}.sql`, FOLDER), "utf8");
      // Räkna bara satser utanför DO-block, där semikolon är inre.
      const withoutDoBlocks = sql.replace(/DO \$\$[\s\S]*?END \$\$;/g, "DO_BLOCK;");
      const statements = withoutDoBlocks.split(";").filter((part) => {
        const code = part
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();
        return code.length > 0;
      }).length;

      if (statements > 1) {
        expect(
          sql.includes("--> statement-breakpoint"),
          `${tag}.sql har ${statements} satser men inga brytpunkter`,
        ).toBe(true);
      }
    }
  });
});
