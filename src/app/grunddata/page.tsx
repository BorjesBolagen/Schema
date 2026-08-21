import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { listEmployees, listStations, listVehicles } from "@/server/basedata";
import { isHostedDatabase } from "@/db";
import { BaseDataAdmin } from "@/components/BaseDataAdmin";

export const dynamic = "force-dynamic";

export default async function BaseDataPage() {
  await requireAdmin();
  const [stations, employees, vehicles] = await Promise.all([
    listStations(),
    listEmployees(),
    listVehicles(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-xs text-(--color-muted) hover:underline">
        ← Tavlor
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Grunddata</h1>
      <p className="mt-2 max-w-[68ch] text-sm text-(--color-muted)">
        Personal och fordon ska på sikt komma från TransPA-synken. Tills kopplingen är på plats —
        och för den som ska med i schemat innan hen finns i TransPA — läggs de upp här. Rader som
        synken äger är märkta; deras namn hämtas om vid nästa körning, medan stationsort och
        bilnamn ägs här och skrivs aldrig över.
      </p>
      {!isHostedDatabase() && (
        <p className="mt-3 rounded border border-(--color-line) bg-amber-50 px-3 py-2 text-xs text-(--color-warn)">
          Den här instansen kör mot den inbäddade databasen. Det som läggs in här följer inte med
          till drift.
        </p>
      )}

      <BaseDataAdmin stations={stations} employees={employees} vehicles={vehicles} />
    </main>
  );
}
