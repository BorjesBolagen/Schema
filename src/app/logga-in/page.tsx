import { redirect } from "next/navigation";
import { getCurrentUser, signIn } from "@/server/auth";
import { needsSetup } from "@/server/setup";
import { LoginForm, type LoginState } from "@/components/LoginForm";
import { Lodjur } from "@/components/Lodjur";

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
  async function attempt(_prev: LoginState | null, formData: FormData): Promise<LoginState | null> {
    "use server";
    const email = String(formData.get("email") ?? "");
    const result = await signIn(email, String(formData.get("password") ?? ""));
    if (!result.ok) return { error: result.error, email };

    // Bara interna vägar, annars går inloggningen att använda för att
    // skicka någon vidare till en annan sajt.
    redirect(retur?.startsWith("/") && !retur.startsWith("//") ? retur : "/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      {/* Märket här och inte i listen: den ritas bara för inloggade, och
          inloggningssidan vore annars den enda sidan utan avsändare. */}
      <div className="flex items-center gap-3">
        <Lodjur className="h-10" />
        <h1 className="text-2xl font-semibold">Schema</h1>
      </div>
      <p className="mt-1 text-sm text-(--color-muted)">Logga in för att komma åt tavlorna.</p>
      <LoginForm action={attempt} />
    </main>
  );
}
