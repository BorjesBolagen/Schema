import { createDb, schema } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";

const db = createDb("memory://");
await runMigrations(db);
const [u] = await db
  .insert(schema.appUser)
  .values({ email: "johan@borjeskoncernen.se", name: "Johan", role: "admin" })
  .returning();
const [b] = await db
  .insert(schema.board)
  .values({ name: "Fjärr Nybro/Hultsfred", slug: "fjarr-nybro-hultsfred", ownerId: u.id })
  .returning();
const [row] = await db
  .insert(schema.boardRow)
  .values({ boardId: b.id, label: "BT08/09", sublabel: "Stockholm", sortOrder: 0 })
  .returning();
await db.insert(schema.assignment).values({ boardRowId: row.id, date: "2026-08-03", slot: 0 });
const rows = await db.select().from(schema.assignment);
console.log("migrations ok, assignments:", rows.length, "| board:", b.name, "| row:", row.label);
