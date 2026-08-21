import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireAdmin } from "@/server/auth";
import { listUsers } from "@/server/users";
import { UserAdmin } from "@/components/UserAdmin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdmin();
  const [users, boards] = await Promise.all([
    listUsers(),
    getDb().select().from(schema.board).orderBy(asc(schema.board.name)),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="text-xs text-(--color-muted) hover:underline">
        ← Tavlor
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Användare</h1>
      <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
        Administratörer når alla tavlor. Planerare når bara de tavlor de fått tillgång till — en
        planerare utan tavlor ser ingenting.
      </p>

      <UserAdmin
        users={users}
        boards={boards.map((b) => ({ id: b.id, name: b.name }))}
        currentUserId={me.id}
      />
    </main>
  );
}
