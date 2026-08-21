/**
 * Skriver ut SQL som skapar eller uppdaterar ett konto.
 *
 * Finns för att ett konto ska gå att lägga upp direkt i Supabases
 * SQL-editor, utan att någon kör node mot produktionsdatabasen.
 * Lösenordet hashas här med samma funktion som appen använder — själva
 * lösenordet hamnar aldrig i databasen.
 *
 *   npx tsx scripts/make-user-sql.ts --email x@y.se --name "Namn" --password "…" [--role admin]
 */
import { parseArgs } from "node:util";
import { hashPassword } from "../src/lib/password";
import { passwordProblem } from "../src/lib/password-rules";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
    role: { type: "string", default: "admin" },
  },
  allowPositionals: true,
});

const { email, name, password, role } = values;
if (!email || !password) {
  console.error('Användning: --email x@y.se --password "…" [--name "Namn"] [--role admin|planner]');
  process.exit(1);
}
if (role !== "admin" && role !== "planner") {
  console.error("--role måste vara admin eller planner");
  process.exit(1);
}

const problem = passwordProblem(password);
const hash = await hashPassword(password);
const esc = (v: string) => v.replace(/'/g, "''");

console.log(`-- Konto: ${email} (${role})`);
if (problem) {
  console.log(`-- OBS: ${problem} Regeln gäller appens formulär, inte den här vägen.`);
}
console.log(`-- Lösenordet är hashat med scrypt och står inte i klartext nedan.
INSERT INTO app_user (email, name, role, password_hash, is_active)
VALUES ('${esc(email.trim().toLowerCase())}', '${esc(name?.trim() || email)}', '${role}', '${hash}', true)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      name          = EXCLUDED.name,
      role          = EXCLUDED.role,
      is_active     = true,
      failed_login_count = 0,
      locked_until  = NULL;`);
