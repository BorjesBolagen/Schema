import { getCurrentUser } from "@/server/auth";
import { signOut } from "@/app/auth-actions";

/** Visar vem som är inloggad. Ritas inte alls när ingen är det. */
export async function UserBar() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="border-b border-(--color-line) bg-white no-print">
      <div className="mx-auto flex max-w-[1700px] items-center justify-end gap-3 px-6 py-1.5 text-xs">
        <span className="text-(--color-muted)">
          {user.name}
          {user.role === "admin" && <span className="ml-1.5">· admin</span>}
        </span>
        <form action={signOut}>
          <button type="submit" className="text-(--color-accent) hover:underline">
            Logga ut
          </button>
        </form>
      </div>
    </div>
  );
}
