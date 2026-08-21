import { createDb } from "../src/db/index";
import { runMigrations } from "../src/db/migrate";

const url = process.env.DATABASE_URL!;
console.log("1. skapar koppling");
const db = createDb(url);

console.log("2. enkel fråga");
const { sql } = await import("drizzle-orm");
console.log("   ->", JSON.stringify(await db.execute(sql`select 1 as x`)).slice(0, 80));

console.log("3. runMigrations");
await runMigrations(db);
console.log("4. klart");
