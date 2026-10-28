import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { importNewEmployees } from "@/server/transpa-sync";
import { isFridayEveningInSweden } from "@/lib/cron-window";

export const dynamic = "force-dynamic";

/**
 * Hämtar nya personer från TransPA varje fredag kväll.
 *
 * Samma hämtning som knappen "Hämta nya personer": den lägger bara till
 * och kopplar ihop handupplagda, och rör aldrig den som redan finns.
 * Varje körning hamnar i sync_run precis som när knappen trycks.
 *
 * Vercel skickar CRON_SECRET som bearer-token. Utan hemligheten satt
 * svarar rutten 401 på allt, så den kan aldrig ligga öppen av misstag.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }

  // ?force=1 kör oavsett tid, för att prova rutten för hand.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && !isFridayEveningInSweden(new Date())) {
    return NextResponse.json({ skipped: "Inte fredag 22 svensk tid." });
  }

  const result = await importNewEmployees();
  revalidatePath("/grunddata");
  revalidatePath("/");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
