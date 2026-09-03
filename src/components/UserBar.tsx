import Link from "next/link";
import { getCurrentUser } from "@/server/auth";
import { signOut } from "@/app/auth-actions";
import { Lodjur } from "./Lodjur";

/**
 * Appens översta list: märket till vänster, kontot till höger.
 *
 * Låg tidigare bara som fyra kontolänkar högerställda i en tunn remsa,
 * utan avsändare. Nu bär den lodjuret och namnet, och en gul linje
 * under — den enda platsen märkeskulören används i full styrka, för den
 * ska synas som en färg och inte läsas som ett ord.
 *
 * Ritas inte alls när ingen är inloggad; inloggningssidan bär märket
 * själv i stället för att en tom list ska ligga över den.
 */
export async function UserBar() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="border-b-2 border-(--color-brand) bg-white no-print">
      <div className="mx-auto flex max-w-[1700px] items-center gap-3 px-6 py-2 text-xs">
        <Link href="/" className="flex items-center gap-2 text-(--color-brand-ink)">
          <Lodjur className="h-7" />
          <span className="text-sm font-semibold tracking-tight">Schema</span>
        </Link>

        <span className="ml-auto text-(--color-muted)">{user.name}</span>
        {user.role === "admin" && (
          <Link href="/anvandare" className="text-(--color-accent) hover:underline">
            Användare
          </Link>
        )}
        <Link href="/konto" className="text-(--color-accent) hover:underline">
          Mitt konto
        </Link>
        <form action={signOut}>
          <button type="submit" className="text-(--color-accent) hover:underline">
            Logga ut
          </button>
        </form>
      </div>
    </div>
  );
}
