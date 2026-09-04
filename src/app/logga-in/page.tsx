import { redirect } from "next/navigation";
import { Manrope, Space_Grotesk } from "next/font/google";
import { getCurrentUser, signIn } from "@/server/auth";
import { needsSetup } from "@/server/setup";
import { LoginForm, type LoginState } from "@/components/LoginForm";
import { Lodjur } from "@/components/Lodjur";
import { internReturväg } from "@/lib/retur";

export const dynamic = "force-dynamic";

/**
 * Profilens två typsnitt, laddade bara här.
 *
 * next/font hämtar dem vid bygget och serverar dem från samma domän, så
 * sidan inte behöver en tur till Google innan den kan ritas. De sätts på
 * inloggningens eget träd i stället för i layouten: resten av appen kör
 * vidare på systemtypsnittet tills omgång 2 rullas ut i sin helhet.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

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
    /* Kryssrutan skickas bara med när den är ikryssad — utan den ska
       kakan dö med webbläsarfönstret. Se createSession. */
    const remember = formData.get("remember") === "on";
    const result = await signIn(email, String(formData.get("password") ?? ""), remember);
    if (!result.ok) return { error: result.error, email, remember };

    /* Bara interna vägar, annars går inloggningen att använda för att
       skicka någon vidare till en annan sajt. Regeln bor i lib/retur.ts
       med sina prov — den som stod här släppte igenom en väg som
       inleddes med snedstreck och bakstreck, vilket webbläsaren gör om
       till en protokollrelativ adress mot en annan värd. */
    redirect(internReturväg(retur));
  }

  return (
    <main
      className={`${display.variable} ${body.variable} relative flex min-h-screen items-center justify-center overflow-hidden bg-(--color-primary) px-4 py-10 font-(family-name:--font-manrope)`}
    >
      {/* Tre lager bakgrund, alla utan eget innehåll: ett gult sken
          uppifrån, ett svagt rutnät som ger djup åt den stora svarta
          ytan, och lodjuret nedsänkt i hörnet. aria-hidden — en skärm-
          läsare har ingenting att hämta i dem. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_-15%,color-mix(in_srgb,var(--color-brand)_18%,transparent),transparent_62%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:56px_56px] opacity-5"
      />
      <Lodjur
        aria-hidden
        alt=""
        className="pointer-events-none absolute -bottom-12 -left-14 w-[300px] max-w-[70vw] opacity-5 brightness-0 invert"
      />

      <div className="relative w-full max-w-[400px] rounded-[18px] bg-white px-[34px] pt-9 pb-[26px] shadow-[0_24px_50px_-22px_rgba(0,0,0,.6)]">
        {/* Märket här och inte i listen: den ritas bara för inloggade, och
            inloggningssidan vore annars den enda sidan utan avsändare. */}
        <div className="mb-[26px] flex flex-col items-center gap-3.5">
          <div className="flex h-[62px] w-[62px] items-center justify-center rounded-2xl bg-(--color-primary) shadow-[inset_0_-3px_0_var(--color-brand)]">
            <Lodjur className="h-9 w-9 brightness-0 invert" />
          </div>
          <div className="flex flex-col items-center gap-[5px]">
            <h1 className="font-(family-name:--font-space-grotesk) text-2xl font-semibold tracking-[-0.01em] text-(--color-ink)">
              Logga in på Schema
            </h1>
            <p className="text-sm text-(--color-login-sub)">Tavlor för schema och semester</p>
          </div>
        </div>

        <LoginForm action={attempt} />

        <div className="mt-[22px] flex items-center justify-between border-t border-(--color-login-rule) pt-4 text-xs text-(--color-login-foot)">
          <span>Börjes Koncernen</span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-(--color-brand)"
            />
            Support 0481-423 00
          </span>
        </div>
      </div>
    </main>
  );
}
