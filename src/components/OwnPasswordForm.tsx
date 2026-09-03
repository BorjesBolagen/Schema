"use client";

import { useState, useTransition } from "react";
import { passwordProblem } from "@/lib/password-rules";
import { changeOwnPassword } from "@/app/user-actions";

export function OwnPasswordForm() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const problem = password ? passwordProblem(password) : null;

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await changeOwnPassword(password);
          setMessage(
            result.ok
              ? { ok: true, text: "Lösenordet är bytt." }
              : { ok: false, text: result.error },
          );
          if (result.ok) setPassword("");
        });
      }}
    >
      <label className="text-xs text-(--color-muted)">
        Nytt lösenord
        <input
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)"
        />
        <span className="mt-1 block text-[11px]">
          {problem ? (
            <span className="text-(--color-warn)">{problem}</span>
          ) : (
            "Minst 12 tecken."
          )}
        </span>
      </label>

      {message && (
        <p
          role="status"
          className={`rounded px-3 py-2 text-sm ${
            message.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-(--color-danger)"
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !password || !!problem}
        className="self-start rounded bg-(--color-primary) px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Byter…" : "Byt lösenord"}
      </button>
    </form>
  );
}
