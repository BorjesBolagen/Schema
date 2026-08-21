"use client";

import { useState, useTransition } from "react";

export function LoginForm({
  action,
}: {
  action: (email: string, password: string) => Promise<string | undefined>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          setError((await action(String(data.get("email")), String(data.get("password")))) ?? null);
        });
      }}
    >
      <label className="text-xs text-(--color-muted)">
        E-post
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
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

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Loggar in…" : "Logga in"}
      </button>
    </form>
  );
}
