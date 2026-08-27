/**
 * Vad slags bil en tavelrad står för.
 *
 * Skiljer sig från rowKind (resurs eller person): den säger vad raden
 * *är*, den här vad den *gör*.
 */
export type VehicleKind = "linjebil" | "bytesbil" | "annan";

export const VEHICLE_KINDS: VehicleKind[] = ["linjebil", "bytesbil", "annan"];

export const VEHICLE_KIND_LABEL: Record<VehicleKind, string> = {
  linjebil: "Linjebil",
  bytesbil: "Bytesbil",
  annan: "Annan",
};

/**
 * Förklaringen som står bredvid valet i tavelredigeraren.
 *
 * Skillnaden är inte självklar för den som inte kör själv, och valet
 * styr vad cellen visar — då ska det gå att förstå utan att fråga.
 */
export const VEHICLE_KIND_HINT: Record<VehicleKind, string> = {
  linjebil: "Två bilar möts på vägen. Riktningen upp eller ner visas i cellen.",
  bytesbil: "Vänder halvvägs varje kväll. Ingen riktning att hålla isär.",
  annan: "Ingen riktning visas.",
};

/** Bara linjebilar har en upp och en ner att hålla isär. */
export function showsDirection(kind: VehicleKind): boolean {
  return kind === "linjebil";
}
