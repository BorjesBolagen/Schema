import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import {
  probeTenant,
  type EndpointProbe,
  type ProbeOutcome,
} from "@/server/transpa-probe";
import { credentialsFromEnv } from "@/lib/transpa/auth";
import { SyncButton } from "@/components/SyncButton";
import { CopyReport } from "@/components/CopyReport";
import { ShiftLookup } from "@/components/ShiftLookup";
import { WriteLog } from "@/components/WriteLog";
import {
  groupWrites,
  TOPIC_LABEL,
  writeVerdict,
} from "@/lib/transpa/write-paths";
import { CHECKS, checkById, costLabel } from "@/lib/transpa/checks";

export const dynamic = "force-dynamic";

const OUTCOME: Record<ProbeOutcome, { label: string; cls: string }> = {
  ok: { label: "Finns", cls: "bg-green-50 text-green-800 border-green-300" },
  empty: {
    label: "Finns, tom",
    cls: "bg-green-50 text-green-800 border-green-300",
  },
  forbidden: {
    label: "Nekad",
    cls: "bg-amber-50 text-(--color-warn) border-amber-300",
  },
  missing: {
    label: "Finns inte",
    cls: "bg-gray-50 text-(--color-muted) border-(--color-line)",
  },
  error: {
    label: "Fel",
    cls: "bg-red-50 text-(--color-danger) border-red-300",
  },
  "not-run": {
    label: "Ej körd",
    cls: "bg-gray-50 text-(--color-muted) border-(--color-line)",
  },
};

function Badge({ outcome }: { outcome: ProbeOutcome }) {
  const o = OUTCOME[outcome];
  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs whitespace-nowrap ${o.cls}`}
    >
      {o.label}
    </span>
  );
}

function Row({ probe }: { probe: EndpointProbe }) {
  return (
    <tr className="border-t border-(--color-line)">
      <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">
        {probe.path}
      </td>
      <td className="py-1.5 pr-4 text-sm">{probe.label}</td>
      <td className="py-1.5 pr-4">
        <Badge outcome={probe.outcome} />
      </td>
      <td className="py-1.5 text-xs text-(--color-muted)">
        {probe.detail ?? (probe.status ? `HTTP ${probe.status}` : "")}
        {probe.sample !== undefined && (
          <span className="ml-2">
            · {probe.sample} rad{probe.sample === 1 ? "" : "er"}
            {probe.rowKey ? ` under ${probe.rowKey}` : ""}
          </span>
        )}
        {/* Fältnamnen är hela poängen med sidan — de avgör om
            stationsort finns i TransPA eller måste sättas här. Bara
            namnen, aldrig värdena. */}
        {probe.sampleKeys && (
          <div className="mt-1 font-mono break-words">
            {probe.sampleKeys.join(", ") || "(tomt svar — inga fält att visa)"}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Rubriken, som båda lägena visar.
 *
 * Sidan har två: en vilande som inte rör API:t, och en körd. Utan den
 * här delade biten skulle de två glida isär.
 */
function Header() {
  return (
    <>
      <Link href="/" className="text-xs text-(--color-muted) hover:underline">
        ← Tavlor
      </Link>
      <h1 className="mt-1 text-xl font-semibold">TransPA-anslutning</h1>
    </>
  );
}

/** Menyn över kontroller, med kostnaden utskriven på varje. */
function CheckMenu({ aktiv }: { aktiv?: string }) {
  return (
    <ul className="mt-4 space-y-2">
      {CHECKS.map((c) => (
        <li key={c.id}>
          <Link
            href={`/transpa?kor=${c.id}`}
            className={`block rounded border p-3 ${
              c.id === aktiv
                ? "border-(--color-warn) bg-amber-50"
                : "border-(--color-line) bg-white hover:border-(--color-warn)"
            }`}
          >
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-sm font-medium">{c.label}</span>
              <span
                className={`text-xs ${
                  c.calls > 5 ? "text-(--color-danger)" : "text-(--color-muted)"
                }`}
              >
                {costLabel(c)}
              </span>
            </span>
            <span className="mt-1 block max-w-[68ch] text-xs text-(--color-muted)">
              {c.what}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Diagnostiken körs inte av sig själv, och aldrig mer än den fråga som
 * ställdes.
 *
 * Sidan svepte förut över allt vid varje rendering — ett trettiotal
 * anrop — och hade force-dynamic, så varje omladdning kostade en full
 * svepning. Under felsökningen blev det hundratals anrop på några
 * dagar, och prenumerationens anropskvot tog slut: TransPA svarade 429
 * på skrivningen, med drygt ett och ett halvt dygn kvar till
 * påfyllning. Kvoten delas med synken, som är det verktyget lever av.
 *
 * Nu väljer man en fråga, och betalar bara för den. Kostnaden står på
 * varje val, eftersom den som väljer är den enda som kan väga den mot
 * hur bråttom det är.
 */
export default async function TranspaPage({
  searchParams,
}: {
  searchParams: Promise<{ kor?: string }>;
}) {
  await requireAdmin();
  const { kor } = await searchParams;
  const check = checkById(kor);

  if (!check) {
    const utanUppgifter = credentialsFromEnv() === null;
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Header />
        <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
          Välj vad som ska kontrolleras. Ingenting anropas förrän du väljer, och
          bara det du valt anropas — anropskvoten är delad med synken och tar
          slut.
        </p>

        {utanUppgifter ? (
          <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
            <p className="font-medium text-(--color-warn)">
              Inga uppgifter inlagda
            </p>
            <p className="mt-1 text-(--color-muted)">
              Sätt <code>TRANSPA_CLIENT_ID</code>,{" "}
              <code>TRANSPA_CLIENT_SECRET</code> och{" "}
              <code>TRANSPA_TENANT_ID</code> i miljön.
            </p>
          </div>
        ) : (
          <CheckMenu />
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Skrivningar till TransPA</h2>
          <p className="mt-1 mb-3 max-w-[68ch] text-xs text-(--color-muted)">
            Varje försök att skicka en schemaändring, med TransPA:s eget svar.
            Läses ur databasen och kostar inga anrop.
          </p>
          <WriteLog />
        </section>
      </main>
    );
  }

  const report = await probeTenant(fetch, check.selection);
  const known = report.endpoints.filter((e) => e.known);
  const guesses = report.endpoints.filter((e) => !e.known);
  const found = guesses.filter(
    (g) => g.outcome === "ok" || g.outcome === "empty",
  );
  const missing = credentialsFromEnv() === null;

  /* Samma uppgifter som tabellerna, men som ren text — se CopyReport. */
  const rapport = [
    `TransPA-diagnostik ${report.ranAt}`,
    `tenant: ${report.tenantId ?? "—"}   token: ${report.token.outcome}`,
    report.token.detail ? `token-detalj: ${report.token.detail}` : null,
    "",
    report.employeeSample
      ? `person-fält: ${report.employeeSample.keys.join(", ") || "(inga)"}\n` +
        `person-id som gick att plocka ut: ${report.employeeSample.id ?? "INGET"}`
      : null,
    report.trips
      ? `turer: ${report.trips.verdict ?? report.trips.outcome} — framåt ${
          report.trips.future?.rows ?? 0
        }, bakåt ${report.trips.past?.rows ?? 0}, status: ${
          report.trips.past?.statuses.join(", ") || "—"
        }`
      : null,
    report.grouping?.outcome === "ok"
      ? "grupper:\n" +
        report.grouping.fields
          .map(
            (f) =>
              `    ${f.field}: ${f.distinct} olika, ${f.matchesStation} matchar ort, ${f.blank} tomma\n` +
              `      ${f.values.map((v) => `${v.value} (${v.count})`).join(" · ")}`,
          )
          .join("\n") +
        `\n    stationsorter: ${report.grouping.stationNames.join(", ")}`
      : null,
    "",
    ...report.endpoints.map(
      (e) =>
        `${e.path}  ${e.outcome}${e.status ? ` (${e.status})` : ""}` +
        `${e.detail ? `  ${e.detail}` : ""}` +
        `${e.sample !== undefined ? `  ${e.sample} rader${e.rowKey ? ` under ${e.rowKey}` : ""}` : ""}` +
        `${e.sampleKeys ? `\n    fält: ${e.sampleKeys.join(", ") || "(tomt svar)"}` : ""}`,
    ),
    "",
    /* Variantmätningen är sidans färskaste uppgift och saknades helt i
       kopieringstexten — det var just den som skulle klistras in. */
    report.shiftVariants?.length
      ? "passvägen, variant för variant:\n" +
        report.shiftVariants
          .map(
            (v) =>
              `    ${v.what}\n` +
              `      ${v.url}\n` +
              `      ${v.outcome}${v.status ? ` (${v.status})` : ""}` +
              `${v.detail ? ` — ${v.detail}` : ""}` +
              `${v.rows !== undefined ? ` — ${v.rows} rader` : ""}` +
              `${v.sampleKeys?.length ? `\n      fält: ${v.sampleKeys.join(", ")}` : ""}`,
          )
          .join("\n")
      : null,
    "",
    report.spec?.shiftOperations?.length
      ? "passvägarna i specen:\n" +
        report.spec.shiftOperations
          .map(
            (op) =>
              `    ${op.method} ${op.path}` +
              `${op.summary ? ` — ${op.summary}` : ""}` +
              `\n      parametrar: ${
                op.parameters
                  .map((x) => `${x.name}${x.required ? " (krävs)" : ""}`)
                  .join(", ") || "inga"
              }`,
          )
          .join("\n")
      : null,
    "",
    report.spec?.outcome === "ok"
      ? `spec: ${report.spec.url} (v${report.spec.version ?? "?"})` +
        `${report.spec.servers?.length ? ` · bas: ${report.spec.servers.join(", ")}` : ""}` +
        `\nparametrar tolken hittade i hela specen: ${report.spec.parameterCount ?? "—"}` +
        `\nparametrar på /v1/shifts/: ${
          report.spec.shiftParameters?.length
            ? report.spec.shiftParameters
                .map(
                  (x) =>
                    `${x.name} (${x.location ?? "utan in"}${x.required ? ", krävs" : ""})`,
                )
                .join(", ")
            : "inga funna"
        }\n` +
        (report.spec.paths ?? []).map((x) => `    ${x}`).join("\n")
      : `spec: kunde inte hämtas (${report.spec?.outcome ?? "ej körd"}${
          report.spec?.status ? ` ${report.spec.status}` : ""
        }), senast provad: ${report.spec?.url ?? "—"}`,
  ]
    .filter((r) => r !== null)
    .join("\n");

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Header />
      <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
        <Link href="/transpa" className="underline">
          ← välj en annan kontroll
        </Link>{" "}
        · Kördes: <strong>{check.label}</strong> ({costLabel(check)}). Sidan
        frågar er tenant vad den faktiskt exponerar. Vismas genererade klient är
        föråldrad — den saknar <code>/v1/trips</code>, som deras egna exempel
        anropar — så den duger inte som facit.
      </p>
      {/* Det som inte kördes står inte som "finns inte" utan visas
          inte alls, och tabellerna nedan listar bara det valda. En rad
          som saknas här betyder alltså "inte frågad", inte "svarade
          inte" — annars vore en sparad körning värre än ingen. */}
      <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
        Fältnamnen från första raden visas — bara namnen, aldrig värdena, så
        personnummer eller adress aldrig syns här.{" "}
        <strong>Passen är hittade och synken hämtar dem.</strong>{" "}
        <code>/v1/shifts/</code> kräver <code>startDateTimeAfter</code> och{" "}
        <code>startDateTimeBefore</code>, och svarar 404 utan dem — det var
        därför vägen såg ut att inte finnas. Arbetsdagarna kommer nu från de
        synkade passen, med arbetsmönstren som reserv för dem TransPA saknar
        besked om. Tidrapporterna är en egen resurs och en annan sak:
        rapporterad tid, inte plan.
      </p>

      {missing ? (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-(--color-warn)">
            Inga uppgifter inlagda
          </p>
          <p className="mt-1 text-(--color-muted)">
            Sätt <code>TRANSPA_CLIENT_ID</code>,{" "}
            <code>TRANSPA_CLIENT_SECRET</code> och{" "}
            <code>TRANSPA_TENANT_ID</code> i miljön. De fås från Visma Developer
            Portal när organisationen registrerats och access beviljats.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded border border-(--color-line) bg-white p-4">
          <span className="text-sm font-medium">Token</span>
          <Badge outcome={report.token.outcome} />
          <span className="text-xs text-(--color-muted)">
            tenant {report.tenantId}
          </span>
          {report.token.detail && (
            <p className="w-full text-xs text-(--color-warn)">
              {report.token.detail}
            </p>
          )}
        </div>
      )}

      {/* En nekad väg är sidans mest informativa rad: den bevisar att
          resursen finns och namnger scopet som saknas. Den ska inte
          ligga bland de döda vägarna längst ned. */}
      {(() => {
        const denied = report.endpoints.filter(
          (e) => e.outcome === "forbidden",
        );
        if (denied.length === 0) return null;
        const scopes = [
          ...new Set(denied.map((e) => e.requiredScope).filter(Boolean)),
        ];
        return (
          <div className="mt-6 rounded border-2 border-(--color-accent) bg-amber-50 p-4">
            <p className="font-medium">Vägar vi saknar behörighet till</p>
            <ul className="mt-2 space-y-1 text-sm">
              {denied.map((e) => (
                <li key={e.path}>
                  <code>{e.path}</code>{" "}
                  <span className="text-(--color-muted)">
                    svarar {e.status}, inte 404
                  </span>
                </li>
              ))}
            </ul>
            {scopes.length > 0 && (
              <>
                <p className="mt-3 max-w-[68ch] text-sm">
                  Begär{" "}
                  {scopes.map((sc, i) => (
                    <span key={sc}>
                      {i > 0 && ", "}
                      <code className="font-semibold">{sc}</code>
                    </span>
                  ))}{" "}
                  i Visma Developer Portal, under samma applikation som de
                  övriga scopen.
                </p>
                {/* Ett 403 bevisar att vägen är registrerad, inte vad den
                    innehåller. Namnet tidrapport pekar mot rapporterad
                    tid, alltså historik som turerna — inte planerade
                    pass. Det ska inte påstås åt något håll här. */}
                <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
                  Tidrapporterna är den tid de anställda rapporterat in —
                  historik, inte plan. De behövs alltså inte för att lägga ett
                  schema. Scopet är ändå värt att begära om ni vill jämföra
                  planerat mot utfört, eller på sikt skriva tillbaka.
                </p>
              </>
            )}
          </div>
        );
      })()}

      {/* Uppslaget står först: det är verktyget som gör frågan konkret
          när något inte stämmer, i stället för att läsa av en tabell
          och gissa. */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold">Slå upp en persons pass</h2>
        <p className="mt-1 mb-3 max-w-[68ch] text-xs text-(--color-muted)">
          Hämtar direkt från TransPA, inte ur den synkade tabellen — poängen är
          att se vad API:t säger, inte vad vi råkar ha sparat. Ange TransPA-id
          eller anställningsnummer.
        </p>
        <ShiftLookup
          defaultPerson="3bfec2f0-0989-404f-8545-30ebeb9b4b38"
          defaultFrom="2026-08-17"
          defaultTo="2026-08-28"
        />
      </section>

      {/* Skrivloggen näst efter uppslaget. En misslyckad skrivning
          syns ingen annanstans: felet fångas och sparas, så det når
          aldrig Vercels logg, och Supabase loggar inte heller ett
          lyckat INSERT. Står svaret inte här står det ingenstans. */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Skrivningar till TransPA</h2>
        <p className="mt-1 mb-3 max-w-[68ch] text-xs text-(--color-muted)">
          Varje försök att skicka en schemaändring, med TransPA:s eget svar.
          Misslyckade försök står kvar — det är där skälet finns när knappen
          säger att något gick fel.
        </p>
        <WriteLog />
      </section>

      {report.shiftVariants && report.shiftVariants.length > 0 && (
        <div className="mt-6 rounded border-2 border-(--color-warn) bg-amber-50 p-4 text-sm">
          <p className="font-medium">Passvägen står i specen men svarar inte</p>
          <p className="mt-1 max-w-[68ch] text-xs text-(--color-muted)">
            <code>/v1/shifts/</code> finns i specen,{" "}
            <code>transpaapi:shifts:read</code> är beviljat och modulen är
            påslagen — ändå kommer 404. Då är felet i anropet. Varianterna nedan
            provas var för sig i stället för att gissa: med och utan snedstreck,
            med specens <em>egna obligatoriska parametrar</em> ifyllda, och mot
            den bas specen anger. Saknas en parameter API:t kräver kan svaret
            bli 404 i stället för 400, och då ser vägen ut att inte finnas.
          </p>
          <table className="mt-3 w-full border-collapse">
            <tbody>
              {report.shiftVariants.map((v) => (
                <tr
                  key={v.url}
                  className="border-t border-(--color-line) align-top"
                >
                  <td className="py-1.5 pr-3 text-xs">{v.what}</td>
                  <td className="py-1.5 pr-3">
                    <Badge outcome={v.outcome} />
                  </td>
                  <td className="py-1.5 text-xs text-(--color-muted)">
                    {v.detail ?? (v.status ? `HTTP ${v.status}` : "")}
                    {v.rows !== undefined && ` · ${v.rows} rader`}
                    {v.sampleKeys && v.sampleKeys.length > 0 && (
                      <div className="mt-1 font-mono break-words text-(--color-ink)">
                        {v.sampleKeys.join(", ")}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 max-w-[68ch] text-xs text-(--color-muted)">
            Svarar den med parametrar men inte de andra är det parametrarna som
            fattades, och hämtningen skrivs mot den formen. Svarar ingen av dem
            behöver Visma tillfrågas om hur anropet ska se ut för er tenant.
          </p>
        </div>
      )}

      {report.trips && (
        <div className="mt-6 rounded border border-(--color-line) bg-white p-4 text-sm">
          <p className="font-medium">Turer: planerade eller körda?</p>
          {report.trips.outcome !== "ok" ? (
            <p className="mt-1 text-xs text-(--color-warn)">
              Gick inte att avgöra: {report.trips.detail}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-(--color-muted)">
                Vecka framåt: {report.trips.future?.capped ? "minst " : ""}
                {report.trips.future?.rows ?? 0} turer · vecka bakåt:{" "}
                {report.trips.past?.capped ? "minst " : ""}
                {report.trips.past?.rows ?? 0} turer fördelade på{" "}
                {report.trips.past?.employees ?? 0} personer
                {report.trips.past?.statuses.length
                  ? ` · status: ${report.trips.past.statuses.join(", ")}`
                  : ""}
              </p>
              <p className="mt-2 max-w-[68ch] text-sm">
                {report.trips.verdict === "planerade"
                  ? "TransPA bär turer som ligger i framtiden — den vet alltså vem som ska jobba. Arbetsdagarna kan hämtas därifrån i stället för att härledas ur ett mönster."
                  : report.trips.verdict === "bara-korda"
                    ? "Bara turer bakåt i tiden. /v1/trips är historik, inte plan."
                    : "Inga turer alls i fönstret. Det säger ingenting säkert; prova igen en vecka då det körts."}
              </p>

              {/* Antalet turer säger inget utan fördelningen. Är en tur
                  ett arbetspass ska nästan varje chaufför ha flera i
                  veckan; ligger snittet kring en är det något annat. */}
              <p className="mt-2 max-w-[68ch] text-sm">
                {(() => {
                  const past = report.trips.past;
                  if (!past || past.rows === 0 || past.employees === 0)
                    return null;
                  const per = past.rows / past.employees;
                  return per < 2
                    ? `Turerna fördelar sig på ${past.employees} personer, ${per.toFixed(1)} per person och vecka. En tur är alltså inget arbetspass — fälten allowanceReductions och borderCrossings pekar mot en traktamentsgrundande resa. Turhistoriken duger då inte för att härleda arbetsdagar, och arbetsmönstren får fyllas i för hand.`
                    : `${per.toFixed(1)} turer per person och vecka. Tätt nog för att kunna säga något om vilka dagar någon kör.`;
                })()}
              </p>
            </>
          )}
        </div>
      )}

      {report.grouping && (
        <div className="mt-6 rounded border border-(--color-line) bg-white p-4 text-sm">
          <p className="font-medium">
            Kan stationsorten hämtas i stället för att sättas för hand?
          </p>
          {report.grouping.outcome !== "ok" ? (
            <p className="mt-1 text-xs text-(--color-warn)">
              Gick inte att avgöra: {report.grouping.detail}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-(--color-muted)">
                Bygger på {report.grouping.sampled} personer och{" "}
                {report.grouping.stationNames.length} stationsorter. Bara
                gruppnamn och antal visas — aldrig vem som har vilket.
              </p>

              {report.grouping.fields.map((f) => {
                const share =
                  f.distinct > 0 ? f.matchesStation / f.distinct : 0;
                return (
                  <div
                    key={f.field}
                    className="mt-3 border-t border-(--color-line) pt-3"
                  >
                    <p>
                      <code>{f.field}</code>
                      <span className="ml-2 text-xs text-(--color-muted)">
                        {f.distinct} olika värden · {f.matchesStation} matchar
                        en stationsort · {f.blank} utan värde
                      </span>
                    </p>
                    <p
                      className={`mt-1 text-sm ${
                        share >= 0.6
                          ? "text-(--color-accent)"
                          : "text-(--color-muted)"
                      }`}
                    >
                      {f.distinct === 0
                        ? "Fältet är tomt för alla — bär ingenting."
                        : share >= 0.6
                          ? "Ser ut att vara orten. Då kan kopplingen göras automatiskt i stället för på 301 personer för hand."
                          : "Matchar inte stationsorterna — det här är något annat."}
                    </p>
                    {f.values.length > 0 && (
                      <p className="mt-1 font-mono text-xs break-words text-(--color-muted)">
                        {f.values
                          .map((v) => `${v.value} (${v.count})`)
                          .join(" · ")}
                        {f.distinct > f.values.length
                          ? ` … +${f.distinct - f.values.length} till`
                          : ""}
                      </p>
                    )}
                  </div>
                );
              })}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-(--color-muted)">
                  Stationsorterna i TransPA (
                  {report.grouping.stationNames.length})
                </summary>
                <p className="mt-1 font-mono text-xs break-words text-(--color-muted)">
                  {report.grouping.stationNames.join(" · ")}
                </p>
              </details>
            </>
          )}
        </div>
      )}

      {report.employeeSample && (
        <div className="mt-6 rounded border border-(--color-line) bg-white p-4 text-sm">
          <p className="font-medium">Fälten på en person</p>
          <p className="mt-1 font-mono text-xs break-all text-(--color-ink)">
            {report.employeeSample.keys.join(", ") ||
              "(svaret innehöll inga fält)"}
          </p>
          <p className="mt-2 text-xs text-(--color-muted)">
            Id som gick att plocka ut:{" "}
            {report.employeeSample.id ? (
              <code>{report.employeeSample.id}</code>
            ) : (
              <span className="text-(--color-warn)">
                inget — då går underresurserna under en person inte att prova
              </span>
            )}
          </p>
        </div>
      )}

      <div className="mt-6">
        <CopyReport text={rapport} />
      </div>

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
        <h2 className="text-sm font-semibold">Vägar som provats</h2>
        <p className="mt-1 max-w-[68ch] text-xs text-(--color-muted)">
          Specen har 47 vägar, och ingen av dem rör frånvaro, semester eller
          arbetsscheman — de ägs alltså här. Listan står kvar som bevakning:
          svarar någon av dem annat än <em>finns inte</em> en dag har Visma
          öppnat resursen, och då är det värt att veta.
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
            {found.length === 1
              ? "En väg svarade"
              : `${found.length} vägar svarade`}
            : {found.map((f) => f.path).join(", ")}. Titta på fältnamnen för att
            avgöra vad den faktiskt innehåller — att en väg svarar säger inte
            att den bär arbetsdagar.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">OpenAPI-specen — hela API:t</h2>
        {report.spec?.outcome === "ok" ? (
          <>
            <p className="mt-1 text-xs text-(--color-muted)">
              Hittad på <code>{report.spec.url}</code>
              {report.spec.version &&
                ` · version ${report.spec.version}`} ·{" "}
              {report.spec.paths?.length} sökvägar
              {report.spec.servers && report.spec.servers.length > 0 && (
                <>
                  {" "}
                  · bas enligt specen:{" "}
                  <code>{report.spec.servers.join(", ")}</code>
                </>
              )}
            </p>

            {/* Svaret på om fas 3 och 4 går att bygga. Det står i specen
                men drunknade bland sextio vägar, och slutsatsen "det
                finns ingen skrivväg" var därför en gissning. */}
            {(() => {
              const writes = report.spec.writes ?? [];
              const verdict = writeVerdict(writes);
              return (
                <div
                  className={`mt-3 rounded border p-3 ${
                    verdict.shifts || verdict.absence
                      ? "border-(--color-accent) bg-white"
                      : "border-(--color-warn) bg-white"
                  }`}
                >
                  <p className="text-sm font-medium">
                    Skrivvägar i specen: {verdict.total}
                  </p>
                  <ul className="mt-1 text-sm">
                    <li>
                      {verdict.shifts ? "✓" : "✗"} Skicka schemaändring —{" "}
                      {verdict.shifts
                        ? "går att bygga"
                        : "ingen väg att skapa eller ändra ett pass"}
                    </li>
                    <li>
                      {verdict.absence ? "✓" : "✗"} Skicka frånvaro —{" "}
                      {verdict.absence
                        ? "går att bygga"
                        : "ingen väg att skapa eller ändra frånvaro"}
                    </li>
                  </ul>

                  {writes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {groupWrites(writes).map(({ topic, writes: rader }) => (
                        <div key={topic}>
                          <p className="text-xs text-(--color-muted)">
                            {TOPIC_LABEL[topic]}
                          </p>
                          <ul className="font-mono text-xs">
                            {rader.map((w) => (
                              <li
                                key={`${w.method} ${w.path}`}
                                className="py-0.5"
                              >
                                <span className="font-semibold">
                                  {w.method}
                                </span>{" "}
                                {w.path}
                                {w.summary && (
                                  <span className="ml-2 font-sans text-(--color-muted)">
                                    {w.summary}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {writes.length === 0 && (
                    <p className="mt-2 max-w-[62ch] text-xs text-(--color-muted)">
                      Specen anger inga vägar alls utöver läsning. Är det
                      riktigt är fas 3 och 4 blockerade på Visma och inte på kod
                      — men kontrollera först att skriv-scopen är beviljade för
                      den här tenanten, eftersom en spec kan vara filtrerad på
                      behörighet.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Passen är det vi letar efter. Ligger de i listan ska de
                inte behöva letas upp för hand bland sextio rader. */}
            {(() => {
              const hits = (report.spec.paths ?? []).filter((p) =>
                /shift|schedul|absen|vacation|timereport|leave/i.test(p),
              );
              return hits.length > 0 ? (
                <div className="mt-2 rounded border border-(--color-accent) bg-amber-50 p-3">
                  <p className="text-sm font-medium">
                    Vägar som rör pass, scheman eller frånvaro ({hits.length})
                  </p>
                  <ul className="mt-1 font-mono text-xs">
                    {hits.map((path) => (
                      <li key={path} className="py-0.5">
                        {path}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-sm text-(--color-warn)">
                  Ingen väg i specen rör pass, scheman eller frånvaro. Då är
                  frågan avgjord.
                </p>
              );
            })()}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-(--color-muted)">
                Alla {report.spec.paths?.length} sökvägar
              </summary>
              <ul className="mt-2 max-h-96 overflow-y-auto rounded border border-(--color-line) bg-white p-3 font-mono text-xs">
                {report.spec.paths?.map((path) => (
                  <li key={path} className="py-0.5">
                    {path}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <>
            <p className="mt-1 max-w-[68ch] text-xs text-(--color-muted)">
              Kunde inte hämtas. Sidan läser numera Swagger-UI:t på{" "}
              <code>api.mytranspa.com/doc/openapi/swaggerui/</code> och plockar
              ut adressen den själv använder, i stället för att gissa. Går inte
              heller det behöver specen hämtas för hand: öppna UI:t i en
              webbläsare, leta upp anropet till spec-filen under Nätverk-fliken,
              och skicka adressen.
            </p>
            {report.spec?.paths && report.spec.paths.length > 0 && (
              <ul className="mt-2 rounded border border-(--color-line) bg-white p-3 font-mono text-xs text-(--color-muted)">
                {report.spec.paths.map((line) => (
                  <li key={line} className="py-0.5">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Synk av grunddata</h2>
        <p className="mt-1 max-w-[68ch] text-xs text-(--color-muted)">
          Hämtar personal, stationsorter och pass, ett bolag i taget, och märker
          varje person med sitt bolag. Passen hämtas fyra veckor bakåt och tolv
          framåt och läses sedan ur databasen — tavelvyn rör aldrig nätet,
          eftersom ett trögt TransPA annars fäller hela sidan. Fordon hämtas
          inte; de skrivs in för hand under Grunddata. Personalens stationsort
          ägs lokalt och skrivs aldrig över.
        </p>
        <div className="mt-3">
          <SyncButton disabled={missing} />
        </div>
      </section>

      {/* Passvägarna ur specen, metod för metod.
          PUT /v1/shifts/{id} svarade 404 med en kropp som säger
          {"statusCode":404,"message":"Resource not found"} direkt efter
          att GET mot samma adress lyckats. Det är inte en väg som
          saknas — det är en begäran som inte uppfyller vad handlaren
          kräver, precis som listvägen svarade 404 tills datumen
          skickades med. Här står vad vägen faktiskt vill ha. */}
      {report.spec?.shiftOperations && report.spec.shiftOperations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Passvägarna i specen</h2>
          <p className="mt-1 mb-3 max-w-[68ch] text-xs text-(--color-muted)">
            Metod för metod, med parametrar. Krävda står i fetstil. Läst ur dokumentet — inga
            anrop mot API:t.
          </p>
          <ul className="space-y-2">
            {report.spec.shiftOperations.map((op) => (
              <li
                key={`${op.method} ${op.path}`}
                className={`rounded border p-3 text-xs ${
                  op.method === "GET"
                    ? "border-(--color-line) bg-white"
                    : "border-(--color-accent) bg-amber-50"
                }`}
              >
                <div className="font-mono break-all">
                  <strong>{op.method}</strong> {op.path}
                </div>
                {op.summary && <div className="mt-1 text-(--color-muted)">{op.summary}</div>}
                <div className="mt-1">
                  {op.parameters.length === 0 ? (
                    <span className="text-(--color-muted)">inga parametrar i specen</span>
                  ) : (
                    op.parameters.map((prm) => (
                      <span key={prm.name} className="mr-3 font-mono">
                        {prm.required ? <strong>{prm.name}</strong> : prm.name}
                        <span className="text-(--color-muted)">
                          {prm.location ? ` (${prm.location})` : ""}
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Menyn igen längst ned. Nästa fråga ställs oftast direkt efter
          den förra, och att behöva gå tillbaka först inbjuder till att
          i stället ladda om — vilket är just det som kostar. */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Kontrollera något annat</h2>
        <CheckMenu aktiv={check.id} />
      </section>

      <p className="mt-8 text-xs text-(--color-muted)">Kört {report.ranAt}</p>
    </main>
  );
}
