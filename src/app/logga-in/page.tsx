import { redirect } from "next/navigation";
import { getCurrentUser, signIn } from "@/server/auth";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ retur?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { retur } = await searchParams;

  async function attempt(email: string, password: string) {
    "use server";
    const result = await signIn(email, password);
    if (result.ok) {
      // Bara interna vägar, annars går inloggningen att använda för att
      // skicka någon vidare till en annan sajt.
      redirect(retur?.startsWith("/") && !retur.startsWith("//") ? retur : "/");
    }
    return result.error;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold">Schema</h1>
      <p className="mt-1 text-sm text-(--color-muted)">
        Logga in för att komma åt tavlorna.
      </p>
      <LoginForm action={attempt} />
    </main>
  );
}
