import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { probeDb } from "@/server/db-health";

export const dynamic = "force-dynamic";

const fmt = (ms: number) => `${ms} ms`;

function speedLabel(ms: number): { text: string; cls: string } {
  if (ms < 200) return { text: "snabbt", cls: "text-green-700" };
  if (ms < 1000) return { text: "märkbart", cls: "text-(--color-warn)" };
  return { text: "långsamt", cls: "text-(--color-danger)" };
}

export default async function DbHealthPage() {
  await requireAdmin();
  const report = await probeDb();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-xs text-(--color-muted) hover:underline">
        ← Tavlor
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Databaskoppling</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-(--color-muted)">
        Kör tre enkla frågor direkt och visar hur lång tid var och en tar. Ladda om sidan för att
        köra om testet — det säger om det är själva kopplingen som är trög, snarare än en
        tavelvy som gör för mycket på en gång.
      </p>

      {/* Ligger databasen efter koden är det den enda uppgift som
          betyder något på sidan — den ska stå överst och inte som en
          rad bland svarstider. */}
      {report.pending.length > 0 && (
        <div className="mt-6 rounded border border-(--color-danger) bg-white p-4">
          <p className="text-sm font-semibold text-(--color-danger)">
            Databasen ligger efter koden
          </p>
          <p className="mt-1 max-w-[60ch] text-sm">
            Kör hela <code>docs/supabase-setup.sql</code> i Supabase → SQL Editor. Filen går att
            köra om; det som redan finns hoppas över.
          </p>
          <ul className="mt-2 font-mono text-xs">
            {report.pending.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        </div>
      )}

      {!report.pendingKnown && (
        <p className="mt-6 rounded border border-(--color-warn) bg-white p-4 text-sm">
          Gick inte att läsa vilka migrationer som körts. Antingen har ingen körts alls, eller
          så saknas behörighet att läsa <code>drizzle.__drizzle_migrations</code>.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-4 rounded border border-(--color-line) bg-white p-4 text-sm">
        <span>
          <span className="text-(--color-muted)">Databas:</span>{" "}
          {report.hosted ? "hostad (Postgres)" : "inbäddad (PGlite)"}
        </span>
        <span>
          <span className="text-(--color-muted)">Funktionens region:</span>{" "}
          {report.region ?? "okänd (lokal körning)"}
        </span>
        <span>
          <span className="text-(--color-muted)">Totalt:</span> {fmt(report.totalMs)}
        </span>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <tbody>
          {report.checks.map((c) => {
            const speed = speedLabel(c.ms);
            return (
              <tr key={c.label} className="border-t border-(--color-line)">
                <td className="py-2 pr-4">{c.label}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">{fmt(c.ms)}</td>
                <td className={`py-2 pr-4 text-xs ${c.ok ? speed.cls : "text-(--color-danger)"}`}>
                  {c.ok ? speed.text : "fel"}
                </td>
                <td className="py-2 text-xs text-(--color-muted)">{c.detail ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-6 max-w-[60ch] text-xs text-(--color-muted)">
        Region ska vara <code>dub1</code> (Dublin) — allt annat betyder att funktionen kör
        långt från databasen. Enstaka frågor under 200 ms är normalt; upprepat långsamma eller
        felande frågor pekar på ett verkligt kopplingsproblem, inte bara avstånd.
      </p>

      <p className="mt-4 text-xs text-(--color-muted)">Kört {report.ranAt}</p>
    </main>
  );
}
