/**
 * Personallista lagrar namn i versaler för ungefär hälften av raderna
 * ("PHILIP SORTTANEN") och med normal skiftning för resten ("Albin
 * Hagberg"). I schemat ska de se likadana ut, så versalnamn skrivs om.
 * Namn som redan har blandad skiftning lämnas orörda — där har någon
 * gjort ett medvetet val.
 */
export function toDisplayName(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (s !== s.toUpperCase()) return s;

  return s
    .toLocaleLowerCase("sv")
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          part ? part[0].toLocaleUpperCase("sv") + part.slice(1) : part,
        )
        .join("-"),
    )
    .join(" ");
}

export function fullDisplayName(e: { firstName: string; lastName: string }): string {
  return `${toDisplayName(e.firstName)} ${toDisplayName(e.lastName)}`.trim();
}
