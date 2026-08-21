/**
 * Slug ur ett tavelnamn.
 *
 * Slugen står i adressen till tavlan, så den ska tåla att skrivas och
 * länkas: bara a–z, siffror och bindestreck. Svenska tecken skrivs om
 * till närmaste latinska bokstav i stället för att falla bort — annars
 * blir "Fjärr Växjö" till "fjrr-vxj".
 */
const TRANSLIT: Record<string, string> = {
  å: "a", ä: "a", á: "a", à: "a", â: "a",
  ö: "o", ø: "o", ó: "o", ò: "o", ô: "o",
  é: "e", è: "e", ê: "e", ë: "e",
  ü: "u", ú: "u", ù: "u",
  í: "i", ì: "i",
  ç: "c", ñ: "n", ß: "ss",
};

export function slugify(raw: string): string {
  const s = raw
    .toLocaleLowerCase("sv")
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s;
}

/**
 * Gör slugen unik genom att räkna upp den. Två tavlor som heter samma
 * sak ska gå att skapa — den andra får bara ett tal efter sig.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = base || "tavla";
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
