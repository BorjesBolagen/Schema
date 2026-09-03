import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb, schema, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { canAccessBoard, canEditBoard } from "./board-scope";

/**
 * board_member.role.
 *
 * Fältet har funnits sedan första migrationen med värdena editor och
 * viewer, men ingenting läste det: alla med tillgång kunde ändra allt.
 * Det var inget hål så länge ingen kunde bli viewer — men fältet såg ut
 * som en spärr, och den som en dag satt role='viewer' i databasen hade
 * fått fulla rättigheter i tro att hen gett läsrätt. Ett fält som finns,
 * tar emot ett värde och inte gör något är värre än ett som saknas.
 *
 * canAccessBoard och canEditBoard bor i board-scope.ts, som är fri från
 * next/navigation och därför går att anropa här. Det är tredje gången
 * den uppdelningen behövts: en modul som drar in React går inte att
 * pröva utan att starta en renderare, och då blir testet källkodsgrep i
 * stället för kontroll.
 */

let db: Db;

beforeEach(async () => {
  if (db) await closeDb(db);
  db = createDb("memory://");
  await runMigrations(db);
});

afterAll(async () => {
  if (db) await closeDb(db);
});

const planerare = (id: string) => ({ id, email: "", name: "", role: "planner" as const });
const fårÄndra = (userId: string, boardId: string) =>
  canEditBoard(planerare(userId), boardId, db);
const fårSe = (userId: string, boardId: string) =>
  canAccessBoard(planerare(userId), boardId, db);

describe("board_member.role", () => {
  it("har editor som förval, så befintliga medlemmar behåller sin rätt", async () => {
    const [u] = await db
      .insert(schema.appUser)
      .values({ email: "a@b.se", name: "A", role: "planner", passwordHash: "x" })
      .returning();
    const [b] = await db.insert(schema.board).values({ name: "T", slug: "t" }).returning();
    await db.insert(schema.boardMember).values({ boardId: b.id, userId: u.id });

    const [m] = await db.select().from(schema.boardMember);
    expect(m.role).toBe("editor");
    expect(await fårÄndra(u.id, b.id)).toBe(true);
  });

  it("nekar ändring för en viewer", async () => {
    const [u] = await db
      .insert(schema.appUser)
      .values({ email: "c@d.se", name: "C", role: "planner", passwordHash: "x" })
      .returning();
    const [b] = await db.insert(schema.board).values({ name: "T", slug: "t" }).returning();
    await db.insert(schema.boardMember).values({ boardId: b.id, userId: u.id, role: "viewer" });

    expect(await fårÄndra(u.id, b.id)).toBe(false);
  });

  it("ger ingen rätt alls till en tavla man inte är medlem i", async () => {
    const [u] = await db
      .insert(schema.appUser)
      .values({ email: "e@f.se", name: "E", role: "planner", passwordHash: "x" })
      .returning();
    const [min] = await db.insert(schema.board).values({ name: "Min", slug: "min" }).returning();
    const [annans] = await db
      .insert(schema.board)
      .values({ name: "Annans", slug: "annans" })
      .returning();
    await db.insert(schema.boardMember).values({ boardId: min.id, userId: u.id });

    expect(await fårÄndra(u.id, min.id)).toBe(true);
    expect(await fårÄndra(u.id, annans.id)).toBe(false);
  });
});

describe("läsa men inte ändra", () => {
  it("låter en viewer se tavlan men inte ändra den", async () => {
    const [u] = await db
      .insert(schema.appUser)
      .values({ email: "g@h.se", name: "G", role: "planner", passwordHash: "x" })
      .returning();
    const [b] = await db.insert(schema.board).values({ name: "T", slug: "t" }).returning();
    await db.insert(schema.boardMember).values({ boardId: b.id, userId: u.id, role: "viewer" });

    expect(await fårSe(u.id, b.id)).toBe(true);
    expect(await fårÄndra(u.id, b.id)).toBe(false);
  });

  /* Administratörer går förbi medlemskapet helt — annars vore
     användarhanteringen omöjlig att komma åt. */
  it("låter en administratör ändra utan medlemskap", async () => {
    const [b] = await db.insert(schema.board).values({ name: "T", slug: "t" }).returning();
    const admin = { id: "00000000-0000-0000-0000-000000000000", email: "", name: "", role: "admin" as const };
    expect(await canEditBoard(admin, b.id, db)).toBe(true);
  });
});
