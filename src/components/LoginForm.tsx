"use client";

import { useActionState, useEffect, useId, useState } from "react";

/** Felet och det som försöktes — se varför nedan. */
export interface LoginState {
  error: string;
  email: string;
  remember: boolean;
}

/* Fälten delar utseende: samma höjd, samma ram, och en gul ring vid
   fokus i stället för webbläsarens egen kontur. Ringen ligger som
   box-shadow så den inte flyttar något, och ramen mörknar samtidigt —
   gult ensamt syns för dåligt mot vitt för att duga som enda markör. */
const FIELD =
  "h-[50px] w-full rounded-[11px] border-[1.5px] border-(--color-field-line) bg-(--color-field) px-3.5 text-[15px] text-(--color-ink) outline-none transition placeholder:text-(--color-muted) focus:border-(--color-primary) focus:bg-white focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_45%,transparent)]";

const LABEL = "text-[12.5px] font-semibold text-(--color-label)";

export function LoginForm({
  action,
}: {
  action: (prev: LoginState | null, formData: FormData) => Promise<LoginState | null>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const passwordId = useId();

  // Utgångsvärdena gäller sidladdningen utan JavaScript, där sidan
  // renderas om från servern med actionens resultat i handen.
  const [email, setEmail] = useState(state?.email ?? "");
  const [remember, setRemember] = useState(state?.remember ?? true);
  const [visible, setVisible] = useState(false);

  /**
   * React 19 nollställer formuläret när en action gått igenom, så efter
   * ett felaktigt försök skulle e-postfältet stå tomt och adressen få
   * skrivas in en gång till. Fältet är därför styrt, och servern
   * skickar tillbaka adressen så den finns kvar även utan JavaScript,
   * där sidan renderas om från början. Detsamma gäller kryssrutan.
   * Lösenordet skickas aldrig tillbaka — det ska skrivas in på nytt.
   */
  useEffect(() => {
    if (!state) return;
    if (state.email) setEmail(state.email);
    setRemember(state.remember);
    // Ett nytt försök ska börja dolt, hur det förra slutade.
    setVisible(false);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-[7px]">
        <span className={LABEL}>E-post</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          placeholder="fornamn.efternamn@borjes.se"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD}
        />
      </label>

      <div className="flex flex-col gap-[7px]">
        {/* Egen label i stället för att svepa fältet: knappen "Visa"
            ligger ovanpå fältet, och inuti en label hade ett klick på
            den räknats som ett klick i fältet. */}
        <label className={LABEL} htmlFor={passwordId}>
          Lösenord
        </label>
        <div className="relative flex">
          <input
            id={passwordId}
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            required
            className={`${FIELD} pr-[74px]`}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            className="absolute top-2 right-2 h-[34px] cursor-pointer rounded-lg bg-(--color-chip) px-3 text-[12.5px] font-semibold text-(--color-label) transition hover:bg-(--color-chip-hover)"
          >
            {visible ? "Dölj" : "Visa"}
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-[9px] text-[13.5px] text-(--color-label)">
        <input
          type="checkbox"
          name="remember"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-[17px] w-[17px] accent-(--color-primary)"
        />
        Håll mig inloggad
      </label>

      {state && (
        <p
          role="alert"
          className="rounded-[11px] bg-red-50 px-3.5 py-2.5 text-sm text-(--color-danger)"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1.5 h-[52px] cursor-pointer rounded-[11px] bg-(--color-primary) font-(family-name:--font-space-grotesk) text-base font-semibold text-white shadow-[0_10px_22px_-12px_color-mix(in_srgb,var(--color-primary)_90%,transparent)] transition hover:bg-(--color-primary-hover) active:translate-y-px disabled:cursor-default disabled:opacity-50"
      >
        {pending ? "Loggar in…" : "Logga in"}
      </button>
    </form>
  );
}
