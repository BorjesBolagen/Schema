"use client";

import { useActionState, useState } from "react";
import { passwordProblem } from "@/lib/password-rules";

export function SetupForm({
  action,
}: {
  action: (prev: string | null, formData: FormData) => Promise<string | null>;
}) {
  const [error, formAction, pending] = useActionState(action, null);
  // Styrda fält: React 19 nollställer formuläret efter en action, och
  // efter ett fel ska man slippa skriva in allt en gång till.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Samma regel som servern använder, så felet syns innan man skickar.
  const local = password ? passwordProblem(password) : null;

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <label className="text-xs text-(--color-muted)">
        Namn
        <input
          name="name"
          required
          autoFocus
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)"
        />
      </label>

      <label className="text-xs text-(--color-muted)">
        E-post
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
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
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)"
        />
        <span className="mt-1 block text-[11px]">
          {local ? (
            <span className="text-(--color-warn)">{local}</span>
          ) : (
            "Minst 12 tecken. En fras du minns slår ett kort krångligt."
          )}
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !!local}
        className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Skapar…" : "Skapa konto och logga in"}
      </button>
    </form>
  );
}
