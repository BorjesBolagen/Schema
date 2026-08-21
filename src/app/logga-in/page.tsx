import { redirect } from "next/navigation";
import { getCurrentUser, signIn } from "@/server/auth";
import { needsSetup } from "@/server/setup";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ retur?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  if (await needsSetup()) redirect("/kom-igang");
  const { retur } = await searchParams;

  /**
   * Riktig formulärhantering i stället för en klickhanterare.
   *
   * Med onSubmit i webbläsaren skickas formuläret som GET innan React
   * hunnit ta över, och då hamnar lösenordet i adressfältet — och
   * därmed i serverloggar och webbläsarhistorik. En server-action gör
   * det till en POST redan från början.
   */
  async function attempt(_prev: string | null, formData: FormData): Promise<string | null> {
    "use server";
    const result = await signIn(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
    if (!result.ok) return result.error;

    // Bara interna vägar, annars går inloggningen att använda för att
    // skicka någon vidare till en annan sajt.
    redirect(retur?.startsWith("/") && !retur.startsWith("//") ? retur : "/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold">Schema</h1>
      <p className="mt-1 text-sm text-(--color-muted)">Logga in för att komma åt tavlorna.</p>
      <LoginForm action={attempt} />
    </main>
  );
}
