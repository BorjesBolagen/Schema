import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth-cookie";

/**
 * Skickar utloggade till inloggningen.
 *
 * Mellanvaran kör på Edge och når inte databasen, så den kan bara se
 * *att* en sessionskaka finns — inte att den är giltig. Den är alltså en
 * genväg, inte gränsen som håller: varje sida och server-action anropar
 * requireUser(), och det är där behörigheten faktiskt kontrolleras.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/logga-in";
  url.search = `?retur=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  /*
    Bilder och ikoner undantas.

    Utan det skickades /lodjur.svg till inloggningen — och just
    inloggningssidan är den enda där ingen är inloggad, så märket blev
    en trasig bild på precis den sida som skulle bära det. Filändelserna
    räknas upp i stället för "allt med en punkt i", så undantaget inte
    växer av sig självt.

    Att lägga ut dem öppet är ofarligt: det är en logotyp. Och den
    verkliga gränsen ligger ändå inte här utan i requireUser() på varje
    sida och server-action — mellanvaran är en genväg.
  */
  matcher: [
    "/((?!logga-in|kom-igang|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|webmanifest)$).*)",
  ],
};
