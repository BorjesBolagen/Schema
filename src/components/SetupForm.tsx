"use client";

import { useState, useTransition } from "react";
import { passwordProblem } from "@/lib/password-rules";

export function SetupForm({
  action,
}: {
  action: (email: string, name: string, password: string) => Promise<string | undefined>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  // Samma regel som servern använder, så felet syns innan man skickar.
  const local = password ? passwordProblem(password) : null;

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          setError(
            (await action(
              String(data.get("email")),
              String(data.get("name")),
              String(data.get("password")),
            )) ?? null,
          );
        });
      }}
    >
      <label className="text-xs text-(--color-muted)">
        Namn
        <input
          name="name"
          required
          autoFocus
          autoComplete="name"
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
        disabled={pending || !!local || !password}
        className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Skapar…" : "Skapa konto och logga in"}
      </button>
    </form>
  );
}
