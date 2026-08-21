import { redirect } from "next/navigation";
import { createFirstAdmin, needsSetup } from "@/server/setup";
import { signIn } from "@/server/auth";
import { SetupForm } from "@/components/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/logga-in");

  async function create(email: string, name: string, password: string) {
    "use server";
    const result = await createFirstAdmin(email, name, password);
    if (!result.ok) return result.error;
    // Logga in direkt — annars är nästa steg att skriva in samma
    // uppgifter en gång till.
    await signIn(email, password);
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold">Kom igång</h1>
      <p className="mt-2 text-sm text-(--color-muted)">
        Databasen är tom. Skapa det första kontot — det blir administratör och kan sedan lägga upp
        övriga. Sidan går inte att nå igen när kontot finns.
      </p>
      <SetupForm action={create} />
    </main>
  );
}
