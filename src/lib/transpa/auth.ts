/**
 * Åtkomsttoken från Visma Connect.
 *
 * TransPA:s Public API stödjer bara client_credentials, alltså
 * maskin-till-maskin. Auktorisationen sker per tenant, så en token gäller
 * en tenant och de scopes den begärdes med.
 */

export const TOKEN_URL = "https://connect.visma.com/connect/token";

export interface TranspaCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Grundscope krävs på alla rutter; resten begärs efter behov.
 *
 * Listan är de scopen som faktiskt är beviljade för Börjes app i Visma
 * Developer Portal (2026-08-24) — inte en gissning ur den föråldrade
 * C#-klienten längre. Två skillnader mot den gissningen: resursen heter
 * `workgroups`, inte `vehiclegroups`, och `trafficareas` finns inte som
 * egen scope alls. Viktigast: `shifts` finns — TransPA har alltså en
 * riktig schema-resurs, inte bara turer.
 *
 * Write-scopen (employees, vehicles, shifts, trips) är också beviljade
 * men begärs inte här — appen skriver ingenting till TransPA än. Läggs
 * till scope för scope när skrivvägen faktiskt byggs (Fas 8: frånvaro
 * och semester tillbaka till TransPA).
 */
export const BASE_SCOPE = "transpaapi:api";

export const READ_SCOPES = [
  BASE_SCOPE,
  "transpaapi:employees:read",
  "transpaapi:vehicles:read",
  "transpaapi:workgroups:read",
  "transpaapi:stationplaces:read",
  "transpaapi:worktasks:read",
  "transpaapi:trips:read",
  "transpaapi:shifts:read",
];

/**
 * Scope för att läsa ett enskilt pass.
 *
 * Skilt från READ_SCOPES, som begär allt appen läser någonstans. En
 * flytt behöver bara passet, och en token ska inte bära mer än anropet
 * använder.
 */
export const SHIFT_READ_SCOPES = [BASE_SCOPE, "transpaapi:shifts:read"];

/**
 * Scope för att skriva pass.
 *
 * Begärs bara av de anrop som faktiskt skriver, aldrig som en del av
 * läs-scopen: en token som får ändra ett schema ska inte ligga i cachen
 * och användas av något som bara skulle läsa. Att de hämtas per anrop
 * kostar en tokenhämtning första gången och inget därefter — cachen
 * nycklas på scope.
 *
 * Läs-scopet ingår *inte*, och det är hela poängen — men det betyder
 * också att den som läser med den här listan får 403. Precis det hände:
 * flytten hämtar passet färskt innan den skriver, och den hämtningen
 * begärde skriv-scopen. TransPA svarade "Claim value mismatch:
 * scope=transpaapi:shifts:read" på en GET, vilket lät som att läsning
 * vore nekad när det i själva verket var vi som bett om fel token.
 */
export const SHIFT_WRITE_SCOPES = [BASE_SCOPE, "transpaapi:shifts:write"];

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Tokens cachas per tenant och scope-uppsättning.
 *
 * Ligger på globalThis av samma skäl som databaskopplingen: Next bygger
 * sidor och server-actions i skilda modulgrafer, och en modullokal cache
 * skulle betyda en ny token per graf.
 */
const CACHE_KEY = Symbol.for("schema.transpa.tokens");
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: Map<string, CachedToken> };

function cache(): Map<string, CachedToken> {
  const g = globalThis as GlobalWithCache;
  g[CACHE_KEY] ??= new Map();
  return g[CACHE_KEY];
}

export class TranspaAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "TranspaAuthError";
  }
}

/** Läser credentials ur miljön. Null när de inte är satta. */
export function credentialsFromEnv(): TranspaCredentials | null {
  const clientId = process.env.TRANSPA_CLIENT_ID;
  const clientSecret = process.env.TRANSPA_CLIENT_SECRET;
  const tenantId = process.env.TRANSPA_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

/**
 * Samma applikation, ett annat bolag.
 *
 * Klient-id och hemlighet delas av alla bolag — det är en och samma
 * Visma-applikation som varje bolag i sin tur ger tillgång. Bara
 * tenant-id skiljer, och det avgör vilket bolags uppgifter token ger
 * tillgång till.
 */
export function credentialsForTenant(tenantId: string): TranspaCredentials | null {
  const clientId = process.env.TRANSPA_CLIENT_ID;
  const clientSecret = process.env.TRANSPA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, tenantId };
}

export async function getAccessToken(
  credentials: TranspaCredentials,
  scopes: string[] = READ_SCOPES,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const scope = [...new Set([BASE_SCOPE, ...scopes])].join(" ");
  const key = `${credentials.tenantId}|${scope}`;

  const hit = cache().get(key);
  // Förnya i förtid så en token inte hinner gå ut mitt i ett anrop.
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope,
      tenant_id: credentials.tenantId,
    }).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new TranspaAuthError(
      `Kunde inte hämta token (${response.status}). Kontrollera client id, secret, tenant och att de begärda scopen är beviljade.`,
      response.status,
      text,
    );
  }

  const data = JSON.parse(text) as TokenResponse;
  cache().set(key, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/** Töm cachen, t.ex. när credentials bytts. */
export function clearTokenCache(): void {
  cache().clear();
}
