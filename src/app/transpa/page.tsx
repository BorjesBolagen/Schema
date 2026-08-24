import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { probeTenant, type EndpointProbe, type ProbeOutcome } from "@/server/transpa-probe";
import { credentialsFromEnv } from "@/lib/transpa/auth";
import { SyncButton } from "@/components/SyncButton";

export const dynamic = "force-dynamic";

const OUTCOME: Record<ProbeOutcome, { label: string; cls: string }> = {
  ok: { label: "Finns", cls: "bg-green-50 text-green-800 border-green-300" },
  empty: { label: "Finns, tom", cls: "bg-green-50 text-green-800 border-green-300" },
  forbidden: { label: "Nekad", cls: "bg-amber-50 text-(--color-warn) border-amber-300" },
  missing: { label: "Finns inte", cls: "bg-gray-50 text-(--color-muted) border-(--color-line)" },
  error: { label: "Fel", cls: "bg-red-50 text-(--color-danger) border-red-300" },
  "not-run": { label: "Ej körd", cls: "bg-gray-50 text-(--color-muted) border-(--color-line)" },
};

function Badge({ outcome }: { outcome: ProbeOutcome }) {
  const o = OUTCOME[outcome];
  return (
    <span className={`rounded border px-2 py-0.5 text-xs whitespace-nowrap ${o.cls}`}>{o.label}</span>
  );
}

function Row({ probe }: { probe: EndpointProbe }) {
  return (
    <tr className="border-t border-(--color-line)">
      <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">{probe.path}</td>
      <td className="py-1.5 pr-4 text-sm">{probe.label}</td>
      <td className="py-1.5 pr-4">
        <Badge outcome={probe.outcome} />
      </td>
      <td className="py-1.5 text-xs text-(--color-muted)">
        {probe.detail ?? (probe.status ? `HTTP ${probe.status}` : "")}
      </td>
    </tr>
  );
}

export default async function TranspaPage() {
  await requireAdmin();
  const report = await probeTenant();
  const known = report.endpoints.filter((e) => e.known);
  const guesses = report.endpoints.filter((e) => !e.known);
  const found = guesses.filter((g) => g.outcome === "ok" || g.outcome === "empty");
  const missing = credentialsFromEnv() === null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="text-xs text-(--color-muted) hover:underline">
        ← Tavlor
      </Link>
      <h1 className="mt-1 text-xl font-semibold">TransPA-anslutning</h1>
      <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
        Sidan frågar er tenant vad den faktiskt exponerar. Vismas genererade klient är föråldrad —
        den saknar <code>/v1/trips</code>, som deras egna exempel anropar — så den duger inte som
        facit. Ladda om sidan för att köra om kontrollen.
      </p>
      <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
        <code>/v1/trips</code> och <code>/v1/employees</code> visar fältnamnen i första raden när
        anropet lyckas — bara namnen, aldrig värdena, så personnummer eller adress aldrig syns här.
        Det är den snabbaste vägen till att veta om en tur bär ett skift eller ett fordon, och om
        personalen bär sin stationsort redan.
      </p>

      {missing ? (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-(--color-warn)">Inga uppgifter inlagda</p>
          <p className="mt-1 text-(--color-muted)">
            Sätt <code>TRANSPA_CLIENT_ID</code>, <code>TRANSPA_CLIENT_SECRET</code> och{" "}
            <code>TRANSPA_TENANT_ID</code> i miljön. De fås från Visma Developer Portal när
            organisationen registrerats och access beviljats.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded border border-(--color-line) bg-white p-4">
          <span className="text-sm font-medium">Token</span>
          <Badge outcome={report.token.outcome} />
          <span className="text-xs text-(--color-muted)">tenant {report.tenantId}</span>
          {report.token.detail && (
            <p className="w-full text-xs text-(--color-warn)">{report.token.detail}</p>
          )}
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Dokumenterade endpoints</h2>
        <table className="mt-2 w-full border-collapse">
          <tbody>
            {known.map((p) => (
              <Row key={p.path} probe={p} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Schema och frånvaro</h2>
        <p className="mt-1 max-w-[68ch] text-xs text-(--color-muted)">
          Namn vi gissar på. Svarar någon av dem något annat än <em>finns inte</em> kan
          arbetsdagarna hämtas från TransPA, och arbetsmönstren i verktyget blir en parentes i
          stället för grunden.
        </p>
        <table className="mt-2 w-full border-collapse">
          <tbody>
            {guesses.map((p) => (
              <Row key={p.path} probe={p} />
            ))}
          </tbody>
        </table>
        {found.length > 0 && (
          <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
            {found.length === 1 ? "En endpoint svarade" : `${found.length} endpoints svarade`}:{" "}
            {found.map((f) => f.path).join(", ")}. Det är den vägen arbetsdagarna ska hämtas.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">OpenAPI-specen</h2>
        {report.spec?.outcome === "ok" ? (
          <>
            <p className="mt-1 text-xs text-(--color-muted)">
              Hittad på <code>{report.spec.url}</code>
              {report.spec.version && ` · version ${report.spec.version}`} ·{" "}
              {report.spec.paths?.length} sökvägar
            </p>
            <ul className="mt-2 max-h-72 overflow-y-auto rounded border border-(--color-line) bg-white p-3 font-mono text-xs">
              {report.spec.paths?.map((path) => (
                <li key={path} className="py-0.5">
                  {path}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-xs text-(--color-muted)">
            Kunde inte hämtas ({OUTCOME[report.spec?.outcome ?? "not-run"].label.toLowerCase()}).
            Specen ligger bakom Vismas Swagger-UI på{" "}
            <code>api.mytranspa.com/doc/openapi/swaggerui/</code> och kan öppnas i en webbläsare.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Synk av grunddata</h2>
        <p className="mt-1 max-w-[68ch] text-xs text-(--color-muted)">
          Hämtar personal, fordon, fordonsgrupper, trafikområden och stationsorter. Bilarnas
          visningsnamn och personalens stationsort ägs lokalt och skrivs aldrig över.
        </p>
        <div className="mt-3">
          <SyncButton disabled={missing} />
        </div>
      </section>

      <p className="mt-8 text-xs text-(--color-muted)">Kört {report.ranAt}</p>
    </main>
  );
}
