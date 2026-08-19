/**
 * Smeknamnshantering.
 *
 * Planerarna skriver "Elle", "Per H", "RASMUS W" — aldrig fullständiga
 * namn. All matchning sker mot en normaliserad form så att versaler,
 * dubbla mellanslag och avslutande skiljetecken inte spelar roll.
 */

/** Gemener, hopdragna mellanslag, utan omgivande skiljetecken. */
export function normalizeAlias(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Texter som förekommer i schemacellerna men aldrig är personnamn.
 * De blir noteringar i stället för misslyckade namnuppslag.
 */
const NOTE_PHRASES = [
  "###",
  "???",
  "lastar själva",
  "går nerifrån",
  "ingen dist!",
  "ingen dist",
  "lotsfirma",
  "östgöta",
  "hyr",
  "skruven",
  "ledig",
  "inställd",
  "byte denna v",
  "körs till lunda",
  "går över dagen",
];

/**
 * Grov gissning om en cell innehåller ett personnamn eller en notering.
 * Används bara för att avgöra vad som hamnar på granskningslistan —
 * innehållet sparas oavsett, så ett felaktigt utfall tappar ingen data.
 */
export function looksLikeName(raw: string): boolean {
  const s = normalizeAlias(raw);
  if (!s) return false;
  if (NOTE_PHRASES.some((p) => s.startsWith(p))) return false;
  if (/\d/.test(s)) return false;
  if (s.length > 24) return false;
  return s.split(" ").length <= 3;
}

/**
 * Kandidatnamn för en person, mest specifika först. Ordningen styr
 * vilket alias som vinner när flera personer skulle kunna matcha.
 */
export function aliasCandidates(p: {
  firstName: string;
  lastName: string;
  displayAlias?: string | null;
  signature?: string | null;
}): string[] {
  const first = p.firstName.trim();
  const last = p.lastName.trim();
  const out: string[] = [];
  const push = (v?: string | null) => {
    const s = v?.trim();
    if (s) out.push(s);
  };

  push(p.displayAlias);
  push(p.signature);
  if (first && last) {
    push(`${first} ${last}`);
    push(`${first} ${last[0]}`);
  }
  push(first);
  // "BAHAA ALDIN SBAHI" skrivs "BAHAA" i schemat.
  const firstToken = first.split(/\s+/)[0];
  if (firstToken !== first) push(firstToken);

  const seen = new Set<string>();
  return out.filter((a) => {
    const n = normalizeAlias(a);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}
