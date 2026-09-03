import type { NextConfig } from "next";

/**
 * Svarsrubriker.
 *
 * Appen skickade inga alls utöver den nosniff Vercel lägger på. Det
 * mesta här är billigt och stoppar en hel klass angrepp:
 *
 *   frame-ancestors  hindrar att sidan läggs i en osynlig iframe på
 *                    någon annans sajt och klickas åt användaren —
 *                    tavlan har knappar som raderar rader och pass.
 *   form-action      hindrar att ett inskjutet formulär postar
 *                    lösenordet till en annan värd.
 *   base-uri         hindrar att en inskjuten <base> flyttar alla
 *                    relativa adresser.
 *   object-src       stänger plugins helt.
 *   Referrer-Policy  läcker inte tavelnamn och veckor i adressen till
 *                    sajter man klickar sig vidare till.
 *
 * script-src släpper igenom inline, och det ska inte läsas som att
 * skripten är skyddade — de är de inte. Next lägger in egna
 * inline-skript för hydreringen, och en policy utan 'unsafe-inline'
 * *bryter appen*: den renderas som stum HTML utan React. Jag provade,
 * mot en riktig produktionsbyggnad, och det var precis vad som hände.
 *
 * Rätt väg är nonce per begäran genom mellanvaran. Den vägen kräver att
 * mellanvaran körs på alla sidor, även inloggningen som i dag är
 * undantagen, och att inloggningens omdirigering byggs om — alltså en
 * ändring i den kod som håller behörigheten. Den är värd att göra, men
 * den ska göras med sin egen verifiering och inte smygas in i en
 * konfigurationsfil.
 *
 * Tills dess: de fyra direktiven ovan är verkliga och gäller. Att låta
 * bli dem för att script-src inte är klar vore att avstå ett skydd som
 * fungerar för att ett annat inte gör det.
 */
const säkerhetsrubriker = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // Se resonemanget ovan — det här är ingen XSS-spärr än.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    /* Inget av det här används. Att stänga av dem betyder att ett
       inskjutet skript inte heller kan be om dem i användarens namn. */
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    /* Bara vettig över HTTPS, vilket är vad drift innebär. Webbläsaren
       struntar i den på localhost. */
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "exceljs"],
  async headers() {
    return [{ source: "/:path*", headers: säkerhetsrubriker }];
  },
};

export default nextConfig;
