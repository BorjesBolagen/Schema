import { looksLikeName, normalizeAlias } from "../../src/lib/alias";

/** null = smeknamnet pekar på flera personer och duger inte som nyckel. */
export type AliasIndex = Map<string, string | null>;

export type Resolution =
  | { kind: "employee"; employeeId: string; matched: string; note: string | null }
  | { kind: "note"; note: string }
  | { kind: "unresolved"; alias: string; note: string; reason: "unknown" | "ambiguous" };

/** Hur många ord från cellens början som får utgöra ett namn. */
const MAX_NAME_WORDS = 3;

/**
 * Tyder en schemacell.
 *
 * Cellerna är sällan bara ett namn — det står "Albin L Sjuk",
 * "CASPER R BT23-->", "Oscar XTRA BIL". Därför provas det längsta
 * inledande namnet först och resten sparas som notering, så att både
 * personen och anteckningen finns kvar.
 */
export function resolveCellText(raw: string, index: AliasIndex): Resolution {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "note", note: "" };

  const words = trimmed.split(/\s+/);
  let sawAmbiguous = false;

  for (let n = Math.min(MAX_NAME_WORDS, words.length); n >= 1; n--) {
    const candidate = words.slice(0, n).join(" ");
    const hit = index.get(normalizeAlias(candidate));
    if (hit === undefined) continue;
    if (hit === null) {
      sawAmbiguous = true;
      continue;
    }
    const rest = words.slice(n).join(" ").trim();
    return { kind: "employee", employeeId: hit, matched: candidate, note: rest || null };
  }

  if (looksLikeName(trimmed)) {
    return {
      kind: "unresolved",
      alias: trimmed,
      note: trimmed,
      reason: sawAmbiguous ? "ambiguous" : "unknown",
    };
  }
  return { kind: "note", note: trimmed };
}

/**
 * Delar upp en cell som rymmer två förare.
 *
 * Turer som delas skrivs med snedstreck — "Dahl/Leffe", "NT/FIB",
 * "JOHAN/FANNY". Bilnummerpar som "4030/4050" ska däremot inte delas,
 * därför krävs att båda halvorna ser ut som namn.
 */
export function splitPair(raw: string): [string, string] | null {
  const parts = raw.split("/").map((p) => p.trim());
  if (parts.length !== 2) return null;
  if (parts.some((p) => p === "" || /\d/.test(p) || p.split(/\s+/).length > 2)) return null;
  return [parts[0], parts[1]];
}

/**
 * Bygger uppslagstabellen. Ett smeknamn som flera personer skulle kunna
 * äga markeras som tvetydigt i stället för att godtyckligt tilldelas
 * den ena — annars hamnar fel person i schemat.
 */
export function buildAliasIndex(
  people: Array<{ id: string; candidates: string[] }>,
): { index: AliasIndex; ambiguous: Map<string, string[]> } {
  const index: AliasIndex = new Map();
  const owners = new Map<string, string[]>();

  for (const p of people) {
    for (const c of p.candidates) {
      const key = normalizeAlias(c);
      if (!key) continue;
      const list = owners.get(key) ?? [];
      if (!list.includes(p.id)) list.push(p.id);
      owners.set(key, list);
    }
  }

  const ambiguous = new Map<string, string[]>();
  for (const [key, ids] of owners) {
    if (ids.length === 1) index.set(key, ids[0]);
    else {
      index.set(key, null);
      ambiguous.set(key, ids);
    }
  }
  return { index, ambiguous };
}
