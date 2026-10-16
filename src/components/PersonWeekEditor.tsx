"use client";

import { useState, useTransition } from "react";
import type { BoardWeek } from "@/server/board-week";
import { setPersonWeekSchedule } from "@/app/actions";
import {
  cyclePosition,
  kommandeVeckor,
  linjerPerCykelvecka,
  MAX_CYCLE_WEEKS,
  type VeckoLinje,
} from "@/lib/rotation";

/** Måndag först — så läses ett schema. */
const VECKODAGAR: Array<[number, string]> = [
  [1, "Mån"],
  [2, "Tis"],
  [3, "Ons"],
  [4, "Tors"],
  [5, "Fre"],
  [6, "Lör"],
  [0, "Sön"],
];

/**
 * En persons schema lagt ut vecka för vecka i cykeln.
 *
 * Den som går i en fyraveckorscykel har fyra olika veckor, och varje
 * vecka kan ha flera linjer: BT13 mån–tors och BT24 på fredagen. Att
 * skriva det som en lista regler med cykelnummer gick, men ingen läste
 * ut veckorna ur den. Här står de bredvid varandra som på papperet.
 */
export function PersonWeekEditor({
  data,
  employeeId,
  name,
  onClose,
}: {
  data: BoardWeek;
  employeeId: string;
  name: string;
  onClose: () => void;
}) {
  const egna = data.baseSchedule.filter((b) => b.employeeId === employeeId);
  /* Den längsta cykeln personen redan har. Kortare cykler ryms i den
     när den är en multipel; annars läggs de ut efter första varvet. */
  const start = egna.reduce(
    (bäst, b) => (b.cycleLength > bäst.cycleLength ? b : bäst),
    { cycleLength: 1, cycleOffset: 0 },
  );
  const blandade = new Set(egna.map((b) => b.cycleLength)).size > 1;

  const [längd, setLängd] = useState(Math.min(start.cycleLength, MAX_CYCLE_WEEKS));
  const [förskjutning, setFörskjutning] = useState(start.cycleOffset % Math.max(1, start.cycleLength));
  const [veckor, setVeckor] = useState<VeckoLinje[][]>(() =>
    linjerPerCykelvecka(egna, start.cycleLength, start.cycleOffset),
  );
  const [pending, startTransition] = useTransition();
  const [fel, setFel] = useState<string | null>(null);

  const förstaRad = data.rows[0]?.id ?? "";

  const ändraVecka = (i: number, f: (linjer: VeckoLinje[]) => VeckoLinje[]) =>
    setVeckor((v) => v.map((linjer, j) => (j === i ? f(linjer) : linjer)));

  const bytLängd = (n: number) => {
    setLängd(n);
    setFörskjutning((o) => o % n);
    /* Nya veckor fylls med det schema personen redan har, upprepat:
       den som kör samma bil varje vecka gör det fortfarande när cykeln
       blir fyra veckor lång, tills någon ändrar en av veckorna. Veckor
       som faller bort sparas inte, men finns kvar i vyn om längden
       ändras tillbaka före Spara. */
    setVeckor((v) =>
      v.length >= n
        ? v
        : [
            ...v,
            ...Array.from({ length: n - v.length }, (_, i) =>
              (v[(v.length + i) % längd] ?? []).map((x) => ({ ...x, weekdays: [...x.weekdays] })),
            ),
          ],
    );
  };

  const spara = () =>
    startTransition(async () => {
      setFel(null);
      try {
        await setPersonWeekSchedule({
          boardSlug: data.board.slug,
          employeeId,
          cycleLength: längd,
          cycleOffset: förskjutning,
          veckor: veckor.slice(0, längd),
        });
        onClose();
      } catch {
        setFel("Kunde inte spara. Försök igen.");
      }
    });

  const Chip = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs ${
        on
          ? "border-(--color-accent) bg-(--color-primary) text-white"
          : "border-(--color-line) bg-white text-(--color-muted) hover:border-(--color-accent)"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">Veckoschema · {name}</h3>
        <button type="button" onClick={onClose} className="text-xs text-(--color-accent) hover:underline">
          ← Tillbaka till listan
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-xs text-(--color-muted)">Cykel</span>
        {Array.from({ length: MAX_CYCLE_WEEKS }, (_, i) => i + 1).map((n) => (
          <Chip
            key={n}
            on={längd === n}
            label={n === 1 ? "varje vecka" : `${n} veckor`}
            onClick={() => bytLängd(n)}
          />
        ))}
      </div>

      {längd > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs text-(--color-muted)">Förskjutning</span>
          {Array.from({ length: längd }, (_, i) => i).map((o) => (
            <Chip
              key={o}
              on={förskjutning === o}
              label={`v.${data.week} = vecka ${cyclePosition(data.week, längd, o)}`}
              onClick={() => setFörskjutning(o)}
            />
          ))}
        </div>
      )}

      {blandade && (
        <p className="text-xs text-(--color-warn)">
          Personen har kopplingar i olika cykellängder. De visas här utlagda i en cykel på {längd}{" "}
          veckor och sparas så.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {veckor.slice(0, längd).map((linjer, i) => (
          <section key={i} className="rounded border border-(--color-line)">
            <header className="flex items-baseline justify-between border-b border-(--color-line) bg-gray-50 px-3 py-1.5">
              <span className="text-sm font-medium">{längd === 1 ? "Varje vecka" : `Vecka ${i + 1}`}</span>
              {längd > 1 && (
                <span className="text-xs text-(--color-muted)">
                  v.{" "}
                  {kommandeVeckor({
                    year: data.year,
                    week: data.week,
                    cycleLength: längd,
                    cycleOffset: förskjutning,
                    cycleWeeks: [i + 1],
                    antal: 3,
                  }).join(", ")}{" "}
                  …
                </span>
              )}
            </header>

            <div className="flex flex-col gap-2 px-3 py-2">
              {linjer.length === 0 && (
                <p className="text-xs text-(--color-muted)">Ingen linje — personen är inte på tavlan den här veckan.</p>
              )}
              {linjer.map((linje, j) => (
                <div key={j} className="flex flex-wrap items-center gap-2">
                  <select
                    value={linje.boardRowId}
                    onChange={(e) =>
                      ändraVecka(i, (l) =>
                        l.map((x, k) => (k === j ? { ...x, boardRowId: e.target.value } : x)),
                      )
                    }
                    className="rounded border border-(--color-line) px-2 py-1 text-sm"
                    aria-label="Linje"
                  >
                    {data.rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                        {r.sublabel ? ` · ${r.sublabel}` : ""}
                      </option>
                    ))}
                  </select>
                  {VECKODAGAR.map(([d, label]) => (
                    <Chip
                      key={d}
                      on={linje.weekdays.includes(d)}
                      label={label}
                      onClick={() =>
                        ändraVecka(i, (l) =>
                          l.map((x, k) =>
                            k === j
                              ? {
                                  ...x,
                                  weekdays: x.weekdays.includes(d)
                                    ? x.weekdays.filter((y) => y !== d)
                                    : [...x.weekdays, d],
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  ))}
                  {linje.weekdays.length === 0 && (
                    <span className="text-xs text-(--color-muted)">inga valda = alla dagar</span>
                  )}
                  <button
                    type="button"
                    onClick={() => ändraVecka(i, (l) => l.filter((_, k) => k !== j))}
                    className="ml-auto text-xs text-(--color-danger) hover:underline"
                  >
                    Ta bort
                  </button>
                </div>
              ))}

              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  disabled={!förstaRad}
                  onClick={() =>
                    ändraVecka(i, (l) => [...l, { boardRowId: förstaRad, weekdays: [1, 2, 3, 4, 5] }])
                  }
                  className="text-(--color-accent) hover:underline disabled:opacity-40"
                >
                  + Lägg till linje
                </button>
                {i > 0 && veckor[i - 1].length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      ändraVecka(i, () => veckor[i - 1].map((x) => ({ ...x, weekdays: [...x.weekdays] })))
                    }
                    className="text-(--color-muted) hover:underline"
                  >
                    Kopiera vecka {i}
                  </button>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          disabled={pending}
          onClick={spara}
          className="rounded bg-(--color-primary) px-3 py-1 text-white disabled:opacity-50"
        >
          {pending ? "Sparar …" : "Spara veckoschema"}
        </button>
        <button type="button" onClick={onClose} className="text-(--color-muted) hover:underline">
          Avbryt
        </button>
        {fel && <span className="text-(--color-danger)">{fel}</span>}
      </div>
    </div>
  );
}
