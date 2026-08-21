import Link from "next/link";
import { requireUser } from "@/server/auth";
import { OwnPasswordForm } from "@/components/OwnPasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <Link href="/" className="text-xs text-(--color-muted) hover:underline">
        ← Tavlor
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Mitt konto</h1>
      <dl className="mt-4 text-sm">
        <div className="flex gap-2">
          <dt className="text-(--color-muted)">Namn</dt>
          <dd>{user.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-(--color-muted)">E-post</dt>
          <dd>{user.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-(--color-muted)">Roll</dt>
          <dd>{user.role === "admin" ? "Administratör" : "Planerare"}</dd>
        </div>
      </dl>

      <h2 className="mt-8 text-sm font-semibold">Byt lösenord</h2>
      <OwnPasswordForm />
    </main>
  );
}
