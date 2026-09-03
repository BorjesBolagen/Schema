"use client";

import { useState, useTransition } from "react";
import { passwordProblem } from "@/lib/password-rules";
import {
  addUser,
  changeUserPassword,
  toggleUserActive,
  updateBoardAccess,
} from "@/app/user-actions";
import type { ManagedUser } from "@/server/users";

interface Props {
  users: ManagedUser[];
  boards: Array<{ id: string; name: string }>;
  currentUserId: string;
}

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("sv-SE") : "—");

export function UserAdmin({ users, boards, currentUserId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | void>) =>
    startTransition(async () => {
      const result = await fn();
      setError(result && "ok" in result && !result.ok ? (result.error ?? "Något gick fel.") : null);
    });

  return (
    <>
      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-(--color-muted) uppercase">
            <th className="py-2 pr-4 font-medium">Namn</th>
            <th className="py-2 pr-4 font-medium">Roll</th>
            <th className="py-2 pr-4 font-medium">Tavlor</th>
            <th className="py-2 pr-4 font-medium">Senast inne</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={`border-t border-(--color-line) ${u.isActive ? "" : "opacity-50"}`}>
              <td className="py-2 pr-4">
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-(--color-muted)">{u.email}</div>
                {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                  <div className="text-xs text-(--color-warn)">Spärrad efter felförsök</div>
                )}
              </td>
              <td className="py-2 pr-4 text-xs">{u.role === "admin" ? "Administratör" : "Planerare"}</td>
              <td className="py-2 pr-4">
                {u.role === "admin" ? (
                  <span className="text-xs text-(--color-muted)">alla</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {boards.map((b) => {
                      const on = u.boardIds.includes(b.id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              updateBoardAccess(
                                u.id,
                                on ? u.boardIds.filter((id) => id !== b.id) : [...u.boardIds, b.id],
                              ),
                            )
                          }
                          className={`rounded border px-2 py-0.5 text-xs ${
                            on
                              ? "border-(--color-accent) bg-(--color-primary) text-white"
                              : "border-(--color-line)"
                          }`}
                        >
                          {b.name}
                        </button>
                      );
                    })}
                    {boards.length === 0 && (
                      <span className="text-xs text-(--color-muted)">inga tavlor ännu</span>
                    )}
                  </div>
                )}
              </td>
              <td className="py-2 pr-4 text-xs text-(--color-muted)">{fmt(u.lastLoginAt)}</td>
              <td className="py-2 text-right text-xs whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setResetting(resetting === u.id ? null : u.id)}
                  className="text-(--color-accent) hover:underline"
                >
                  Nytt lösenord
                </button>
                {u.id !== currentUserId && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => toggleUserActive(u.id, !u.isActive))}
                    className="ml-3 text-(--color-danger) hover:underline"
                  >
                    {u.isActive ? "Stäng av" : "Aktivera"}
                  </button>
                )}
                {resetting === u.id && (
                  <PasswordBox
                    onCancel={() => setResetting(null)}
                    onSave={(pw) =>
                      run(async () => {
                        const r = await changeUserPassword(u.id, pw);
                        if (r.ok) setResetting(null);
                        return r;
                      })
                    }
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6">
        {adding ? (
          <NewUserForm
            boards={boards}
            onCancel={() => setAdding(false)}
            onSave={(input) =>
              run(async () => {
                const r = await addUser(input);
                if (r.ok) setAdding(false);
                return r;
              })
            }
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded bg-(--color-primary) px-4 py-1.5 text-sm text-white"
          >
            Lägg till användare
          </button>
        )}
      </div>
    </>
  );
}

function PasswordBox({ onSave, onCancel }: { onSave: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  const problem = pw ? passwordProblem(pw) : null;
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="Nytt lösenord"
        className="rounded border border-(--color-line) px-2 py-1 text-sm text-(--color-ink)"
      />
      <button
        type="button"
        disabled={!pw || !!problem}
        onClick={() => onSave(pw)}
        className="rounded bg-(--color-primary) px-2 py-1 text-white disabled:opacity-40"
      >
        Spara
      </button>
      <button type="button" onClick={onCancel}>
        Avbryt
      </button>
      {problem && <span className="text-(--color-warn)">{problem}</span>}
    </div>
  );
}

function NewUserForm({
  boards,
  onSave,
  onCancel,
}: {
  boards: Props["boards"];
  onSave: (input: {
    email: string;
    name: string;
    role: "admin" | "planner";
    password: string;
    boardIds: string[];
  }) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<"admin" | "planner">("planner");
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const problem = password ? passwordProblem(password) : null;

  return (
    <form
      className="rounded border border-(--color-line) bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onSave({
          email: String(data.get("email")),
          name: String(data.get("name")),
          role,
          password,
          boardIds: role === "admin" ? [] : boardIds,
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-(--color-muted)">
          Namn
          <input
            name="name"
            required
            autoFocus
            className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          />
        </label>
        <label className="text-xs text-(--color-muted)">
          E-post
          <input
            name="email"
            type="email"
            required
            className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          />
        </label>
        <label className="text-xs text-(--color-muted)">
          Roll
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          >
            <option value="planner">Planerare</option>
            <option value="admin">Administratör</option>
          </select>
        </label>
        <label className="text-xs text-(--color-muted)">
          Lösenord
          <input
            type="text"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block rounded border border-(--color-line) px-2 py-1.5 text-sm text-(--color-ink)"
          />
        </label>
      </div>

      {role === "planner" && boards.length > 0 && (
        <div className="mt-3 text-xs text-(--color-muted)">
          Tavlor
          <div className="mt-1 flex flex-wrap gap-1">
            {boards.map((b) => {
              const on = boardIds.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() =>
                    setBoardIds(on ? boardIds.filter((id) => id !== b.id) : [...boardIds, b.id])
                  }
                  className={`rounded border px-2 py-0.5 ${
                    on ? "border-(--color-accent) bg-(--color-primary) text-white" : "border-(--color-line)"
                  }`}
                >
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {problem && <p className="mt-2 text-xs text-(--color-warn)">{problem}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!!problem || !password}
          className="rounded bg-(--color-primary) px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Skapa
        </button>
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm">
          Avbryt
        </button>
      </div>
    </form>
  );
}
