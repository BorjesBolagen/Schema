"use client";

import { useActionState, useEffect, useState } from "react";

/** Felet och den e-post som försöktes — se varför nedan. */
export interface LoginState {
  error: string;
  email: string;
}

export function LoginForm({
  action,
}: {
  action: (prev: LoginState | null, formData: FormData) => Promise<LoginState | null>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  // Utgångsvärdet gäller sidladdningen utan JavaScript, där sidan
  // renderas om från servern med actionens resultat i handen.
  const [email, setEmail] = useState(state?.email ?? "");

  /**
   * React 19 nollställer formuläret när en action gått igenom, så efter
   * ett felaktigt försök skulle e-postfältet stå tomt och adressen få
   * skrivas in en gång till. Fältet är därför styrt, och servern
   * skickar tillbaka adressen så den finns kvar även utan JavaScript,
   * där sidan renderas om från början. Lösenordet skickas aldrig
   * tillbaka — det ska skrivas in på nytt.
   */
  useEffect(() => {
    if (state?.email) setEmail(state.email);
  }, [state]);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <label className="text-xs text-(--color-muted)">
        E-post
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)"
        />
      </label>

      <label className="text-xs text-(--color-muted)">
        Lösenord
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)"
        />
      </label>

      {state && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-(--color-danger)">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-(--color-primary) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Loggar in…" : "Logga in"}
      </button>
    </form>
  );
}
