"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBoard } from "@/app/basedata-actions";
import type { BoardTemplate } from "@/server/boards";

interface Props {
  templates: Array<{ id: BoardTemplate; name: string; description: string }>;
  /** Öppen från början när det inte finns någon tavla att välja bland. */
  startOpen?: boolean;
}

const field =
  "mt-1 w-full rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)";

export function NewBoardForm({ templates, startOpen = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<BoardTemplate>(templates[0].id);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-6 rounded border border-(--color-line) px-4 py-2 text-sm hover:bg-white"
      >
        Ny tavla
      </button>
    );
  }

  const submit = () =>
    startTransition(async () => {
      const result = await addBoard({ name, template });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Direkt in i den nya tavlan — nästa steg är alltid att bygga den.
      router.push(`/tavla/${result.slug}`);
    });

  return (
    <div className="mt-6 rounded border border-(--color-line) bg-white p-5">
      <h2 className="text-sm font-medium">Ny tavla</h2>
      <p className="mt-1 text-xs text-(--color-muted)">
        Välj ett utgångsläge. Veckodagar, skift, rader och namn ändras sedan fritt i tavlan.
      </p>

      <label className="mt-4 block text-xs text-(--color-muted)">
        Namn
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
          placeholder="Fjärr Nybro/Hultsfred"
          className={field}
        />
      </label>

      <fieldset className="mt-4">
        <legend className="text-xs text-(--color-muted)">Layout</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {templates.map((t) => (
            <label
              key={t.id}
              className={`flex-1 cursor-pointer rounded border px-4 py-3 text-sm ${
                template === t.id
                  ? "border-(--color-accent) bg-blue-50/50"
                  : "border-(--color-line)"
              }`}
            >
              <input
                type="radio"
                name="template"
                className="sr-only"
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
              />
              <span className="font-medium">{t.name}</span>
              <span className="mt-1 block text-xs text-(--color-muted)">{t.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={submit}
          disabled={pending || !name.trim()}
          className="rounded bg-(--color-primary) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Skapar…" : "Skapa tavla"}
        </button>
        {!startOpen && (
          <button
            onClick={() => setOpen(false)}
            className="rounded border border-(--color-line) px-4 py-2 text-sm"
          >
            Avbryt
          </button>
        )}
      </div>
    </div>
  );
}
