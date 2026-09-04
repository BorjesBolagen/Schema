/**
 * Vart inloggningen får skicka någon efteråt.
 *
 * Mellanvaran lägger den sida man ville åt i ?retur=, och inloggningen
 * går dit när det gått vägen. Adressen kommer alltså från en länk, och
 * en länk kan vem som helst skriva: utan spärr är inloggningen en
 * vidarebefordran till valfri sajt, med Börjes domän i adressfältet
 * ända fram till hoppet. Det är sådana länkar nätfiske vill ha.
 *
 * Kravet "börjar med / men inte //" räcker inte. Webbläsare gör om
 * bakstreck till snedstreck i en adress, så en väg som börjar med
 * snedstreck-bakstreck blir protokollrelativ och pekar på en annan värd
 * — genom en kontroll som såg heltäckande ut. Samma sak med ett
 * radbrott eller en tabb inskjuten i Location-rubriken.
 *
 * Därför en vitlista i stället för en svartlista: en väg är intern bara
 * om den börjar med ett snedstreck, det som följer varken är ännu ett
 * snedstreck eller ett bakstreck, och inget tecken i den är ett
 * styrtecken. Allt annat blir startsidan — ett misslyckat hopp är en
 * olägenhet, ett lyckat är ett angrepp.
 */
export function internReturväg(retur: string | null | undefined): string {
  if (!retur || !retur.startsWith("/")) return "/";
  // Bakstreck, radbrott, tabb, mellanslag och övriga styrtecken.
  if (/[\u0000-\u0020\u007f\\]/.test(retur)) return "/";
  if (retur.startsWith("//")) return "/";
  return retur;
}
