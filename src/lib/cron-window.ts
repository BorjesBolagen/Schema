/**
 * Avgör om en cron-körning hamnat på fredag kväll svensk tid.
 *
 * Vercel Cron räknar bara i UTC, så fredag 22:00 här är 20:00 UTC på
 * sommaren och 21:00 UTC på vintern. Båda tiderna ligger i vercel.json
 * och den här kollen släpper igenom den som faktiskt är 22 i Stockholm
 * — den andra blir en tom körning. Bara timmen jämförs: på Hobby-planen
 * kan Vercel starta jobbet var som helst inom timmen.
 */
export function isFridayEveningInSweden(now: Date, hour = 22): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const localHour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Fri" && localHour === hour;
}
