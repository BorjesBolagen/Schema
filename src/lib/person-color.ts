/**
 * Färg per person i rutnätet.
 *
 * Syftet är igenkänning, inte dekoration: samma person ska ha samma
 * kulör i varje cell, så ögat kan följa en rad utan att läsa namnen.
 *
 * Därför en fast palett och inte en fri hue-rotation. Fritt roterade
 * kulörer hamnar förr eller senare i lera eller skriker, och två
 * grannar kan bli omöjliga att skilja åt. De här tolv är valda med
 * samma ljushet och samma låga mättnad, så ingen sticker ut och en tavla
 * med tolv personer inte blir en julgran.
 *
 * Fyllningen är nästan vit — den bär identiteten utan att ta över.
 * Kanten är samma kulör men mörkare, och det är den som gör kortet
 * urskiljbart på avstånd.
 */

export interface PersonColor {
  /** Nästan vit fyllning. */
  bg: string;
  /** Samma kulör, mörkare — kortets kant. */
  border: string;
}

const PALETTE: PersonColor[] = [
  { bg: "#eaf1fb", border: "#a9c4e6" }, // blå
  { bg: "#e6f2ef", border: "#9fcabf" }, // teal
  { bg: "#ecf4e8", border: "#b3cfa5" }, // grön
  { bg: "#f8f1e0", border: "#dbc48d" }, // sand
  { bg: "#fbeee7", border: "#e5bda4" }, // orange
  { bg: "#fbedf0", border: "#e6afb9" }, // rosa
  { bg: "#f3edfa", border: "#c5b0e0" }, // lila
  { bg: "#eeeefb", border: "#b3b4e4" }, // indigo
  { bg: "#e7f1f6", border: "#a6c7d8" }, // cyan
  { bg: "#f2f3e4", border: "#c9cd9d" }, // oliv
  { bg: "#f7eef5", border: "#dcb2d2" }, // plommon
  { bg: "#eaf0ee", border: "#adc3bc" }, // grågrön
];

/**
 * Stabil kulör ur ett id.
 *
 * Hashen behöver inte vara bra, bara likadan varje gång och jämnt
 * spridd — annars hamnar halva bemanningen på samma kulör.
 */
export function personColor(employeeId: string): PersonColor {
  let hash = 0;
  for (let i = 0; i < employeeId.length; i++) {
    hash = (hash * 31 + employeeId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export const PERSON_COLORS = PALETTE.length;
