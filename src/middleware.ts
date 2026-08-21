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
  matcher: ["/((?!logga-in|_next/static|_next/image|favicon.ico).*)"],
};
