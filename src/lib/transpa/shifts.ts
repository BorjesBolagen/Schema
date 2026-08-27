import type { Shift, WorkDay } from "@/lib/work-days";

/**
 * Pass ur TransPA.
 *
 * Formen är bekräftad mot tenanten (2026-08-27), inte gissad:
 *
 *     GET /v1/shifts/?startDateTimeAfter=…&startDateTimeBefore=…
 *
 * Båda tidsgränserna är obligatoriska, och `startDateTimeBefore` måste
 * ligga efter `startDateTimeAfter` — annars svarar API:t 400. Utan dem
 * svarar vägen 404, vilket är precis varför den såg ut att inte finnas.
 *
 * Ett pass bär inget slutdatum. Längden ligger i
 * `adjustedWorkTimeInMinutes`, som enligt Vismas eget schema räknas
 * fram av resursen calculateAdjustedWorkTime.
 */

/**
 * Datum och timme i svensk lokaltid.
 *
 * TransPA skickar UTC. Ett pass som startar 22:30Z en måndag i augusti
 * är tisdag 00:30 här — fel dag och fel skift om tidpunkten läses rakt
 * av, vilket är hela skälet till att omräkningen finns.
 */
const STOCKHOLM = "Europe/Stockholm";

export function localParts(iso: string, timeZone = STOCKHOLM): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // hourCycle h23 ger "24" för midnatt i vissa körningar; normalisera.
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

export interface TranspaShift {
  id?: string;
  employeeId?: string | null;
  /** ISO-tidpunkt i UTC. Obligatorisk enligt schemat. */
  startDateTime?: string;
  /** Passets längd i minuter, 1–1440. */
  adjustedWorkTimeInMinutes?: number;
  /** Pass utanför ordinarie arbetstid. */
  isExtraShift?: boolean;
  name?: string | null;
  description?: string | null;
  externalId?: string | null;
}

/** Sökvägen för hela bolagets pass i ett tidsfönster. */
export const SHIFTS_PATH = "/v1/shifts/";

/**
 * Tidsfönstret som frågeparametrar.
 *
 * `from` och `to` är datum (YYYY-MM-DD) som veckovyn räknar i, alltså
 * svenska kalenderdagar. TransPA jämför mot UTC.
 *
 * Marginalen på ett dygn i vardera riktningen är inte slarv utan
 * nödvändig. Kommentaren här påstod tidigare att den fanns medan koden
 * satte gränserna rakt på `T00:00:00Z` — och den blev 02:00 svensk tid
 * på sommaren. Ett pass som börjar 00:30 natten till veckans första dag
 * låg då utanför fönstret och hämtades aldrig, vilket är just de
 * nattpass vi bryr oss mest om.
 *
 * Det som hämtas för mycket kostar ingenting: skrivningen filtrerar på
 * den framräknade arbetsdagen ändå.
 */
export function shiftWindow(from: string, to: string): Record<string, string> {
  const dygn = (date: string, skift: number) =>
    new Date(new Date(`${date}T00:00:00Z`).getTime() + skift * DAY_MS).toISOString();

  return {
    startDateTimeAfter: dygn(from, -1),
    startDateTimeBefore: dygn(to, 2),
  };
}

/**
 * Största spann TransPA tar i ett anrop.
 *
 * "startDateTimeAfter and startDateTimeBefore needs to be within 31
 * days" — svaret på synkens första skarpa körning, som bad om sexton
 * veckor. Trettio används i stället för trettioett: fönstret sträcker
 * sig till 23:59:59 på slutdagen, så ett spann på trettioen
 * kalenderdagar ligger nästan precis på gränsen.
 */
export const MAX_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const asIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Delar ett datumintervall i bitar API:t accepterar.
 *
 * Bitarna gränsar till varandra utan överlapp och utan glapp: nästa
 * börjar dagen efter att föregående slutar. Ett pass kan alltså varken
 * missas eller hämtas två gånger.
 */
export function splitIntoWindows(
  from: string,
  to: string,
  maxDays = MAX_WINDOW_DAYS,
): Array<{ from: string; to: string }> {
  const start = asDate(from);
  const end = asDate(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const out: Array<{ from: string; to: string }> = [];
  for (let at = start; at <= end; at += maxDays * DAY_MS) {
    const last = Math.min(at + (maxDays - 1) * DAY_MS, end);
    out.push({ from: asIso(at), to: asIso(last) });
  }
  return out;
}

/**
 * Dag eller natt, enligt Börjes egna gränser.
 *
 * Ett dagpass börjar tidigast 04 och slutar senast 20. Ett nattpass
 * börjar mellan 17 och midnatt och håller på högst tolv timmar. De
 * överlappar mellan 17 och 20, och där avgör sluttiden: går passet ut
 * före 20 är det dag, annars natt.
 *
 * Sluttiden räknas ur adjustedWorkTimeInMinutes, eftersom TransPA inte
 * skickar något slutdatum. Saknas längden går bara starttiden att gå
 * på, och då är 17 gränsen.
 */
export const DAY_STARTS_AT = 4;
export const DAY_ENDS_BY = 20;
export const NIGHT_STARTS_AT = 17;

export function classifyShift(startHour: number, workMinutes: number | null | undefined): Shift {
  // Före dagens början är det gårdagens natt som fortsätter.
  if (startHour < DAY_STARTS_AT) return "night";

  if (workMinutes == null) return startHour >= NIGHT_STARTS_AT ? "night" : "day";

  const endsAt = startHour + workMinutes / 60;
  if (endsAt <= DAY_ENDS_BY) return "day";
  return startHour >= NIGHT_STARTS_AT ? "night" : "day";
}

/**
 * Ett pass som en arbetsdag.
 *
 * Dagen och skiftet avgörs av svensk lokaltid, inte av UTC: ett pass
 * som startar 22:30Z en måndag i augusti är tisdag 00:30 här — fel dag
 * och fel skift om man läser tidpunkten rakt av.
 *
 * Null när passet saknar person eller starttid; ett pass utan dem säger
 * ingenting om vem som jobbar när.
 */
export function shiftToWorkDay(shift: TranspaShift, employeeId: string): WorkDay | null {
  if (!shift.startDateTime) return null;
  const when = new Date(shift.startDateTime);
  if (Number.isNaN(when.getTime())) return null;

  const { date, hour } = localParts(shift.startDateTime);
  const kind = classifyShift(hour, shift.adjustedWorkTimeInMinutes);

  /* Ett nattpass hör till kvällen det började, inte till morgonen det
     slutar. Ett pass som startar efter midnatt men före dagens början
     är alltså gårdagens natt.

     Utan det dök nattfolk upp två dagar i rad: delen som låg efter
     midnatt hamnade på nästa dag, bredvid samma natts kvällsdel, som om
     personen kört två nätter. */
  const efterMidnatt = kind === "night" && hour < DAY_STARTS_AT;
  return { employeeId, date: efterMidnatt ? dagenFore(date) : date, shift: kind };
}

/** Dagen före, räknat i kalenderdagar. */
function dagenFore(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Längsta uppehåll som fortfarande räknas som samma pass.
 *
 * TransPA delar ibland en natt i flera poster. Startimmen ensam kan
 * inte skilja svansen av en natt från början av en ny dag — ett pass
 * som börjar 04:30 kan vara antingen. Det som skiljer är vilan före:
 * svansen börjar minuter efter att kvällsdelen slutade, dagpasset efter
 * en hel natts vila.
 *
 * Fem timmar är ett val, inte en mätning, och fönstret är smalare än
 * det ser ut. Nedåt: en svans som börjar 04:30 efter en kvällsdel som
 * slutade 00:00 ligger 4,5 timmar bort och ska hänga ihop — det är
 * felet som rapporterades. Uppåt: samma kvällsdel följd av ett pass
 * 06:00 är sex timmar bort och ska läsas som två dygn. Gränsen måste
 * ligga mellan 4,5 och 6.
 *
 * Båda de talen är dock rimliga exempel, inte avlästa ur TransPA. Innan
 * gränsen betraktas som satt ska den stämmas av mot verkliga pass för
 * en nattchaufför — vi vet ännu inte hur TransPA delar sina nätter
 * eller hur stora uppehållen är i praktiken.
 */
export const SAMMA_PASS_LUCKA_MS = 5 * 60 * 60 * 1000;

/** Passets slut enligt TransPA:s längduppgift, eller null när den saknas. */
function slutarVid(shift: TranspaShift): number | null {
  if (!shift.startDateTime || shift.adjustedWorkTimeInMinutes == null) return null;
  const start = new Date(shift.startDateTime).getTime();
  if (Number.isNaN(start)) return null;
  return start + shift.adjustedWorkTimeInMinutes * 60_000;
}

/**
 * En persons pass som arbetsdagar, med nätterna hela.
 *
 * Skillnaden mot att mappa varje pass för sig är att pass här läses i
 * ordning, så ett pass kan höra till föregående passets arbetsdag. Utan
 * det syntes nattfolk på två dagar: kvällsdelen på måndagen som natt,
 * och svansen som började efter 04:00 på tisdagen som *dag*. Det var
 * inte två pass utan ett, och personen stod som dagpersonal på en dag
 * hen sov.
 *
 * Delar TransPA inte nätterna gör regeln ingenting — då finns inget
 * föregående pass tillräckligt nära, och varje pass klassas som förut.
 */
export function attributeShifts(
  shifts: TranspaShift[],
  employeeId: string,
): Array<{ shift: TranspaShift; day: WorkDay }> {
  const iOrdning = shifts
    .filter((s) => s.startDateTime && !Number.isNaN(new Date(s.startDateTime).getTime()))
    .sort((a, b) => a.startDateTime!.localeCompare(b.startDateTime!));

  const ut: Array<{ shift: TranspaShift; day: WorkDay }> = [];
  let foregaende: { dag: WorkDay; slut: number } | null = null;

  for (const shift of iOrdning) {
    const start = new Date(shift.startDateTime!).getTime();

    /* Följer passet tätt på det förra hör det till samma arbetsdag —
       samma datum och samma skift, oavsett vad starttimmen säger. */
    const fortsatter: boolean =
      foregaende !== null && start - foregaende.slut <= SAMMA_PASS_LUCKA_MS;

    const dag: WorkDay | null =
      fortsatter && foregaende !== null
        ? { employeeId, date: foregaende.dag.date, shift: foregaende.dag.shift }
        : shiftToWorkDay(shift, employeeId);
    if (!dag) continue;

    /* Slutet räknas alltid ur passet självt. Ärvde en kedja av korta
       pass den första postens slut skulle den kunna växa i all
       oändlighet och svälja nästa dygn. */
    foregaende = { dag, slut: slutarVid(shift) ?? start };
    ut.push({ shift, day: dag });
  }

  return ut;
}

/** Arbetsdagarna ur en persons pass, utan dubbletter. */
export function workDaysForPerson(shifts: TranspaShift[], employeeId: string): WorkDay[] {
  const sedda = new Set<string>();
  return attributeShifts(shifts, employeeId).flatMap(({ day }) => {
    const nyckel = `${day.date}|${day.shift}`;
    if (sedda.has(nyckel)) return [];
    sedda.add(nyckel);
    return [day];
  });
}

/**
 * Arbetsdagar ur en samling pass, utan dubbletter.
 *
 * Två pass samma dag och skift — ett delat pass, eller ett extrapass —
 * är fortfarande en arbetsdag. Dag och natt samma dygn är däremot två,
 * och tavlan visar dem på var sin rad.
 */
export function workDaysFromShifts(
  shifts: TranspaShift[],
  employeeIdFor: (transpaId: string) => string | undefined,
): { workDays: WorkDay[]; covered: string[] } {
  const seen = new Set<string>();
  const workDays: WorkDay[] = [];
  const covered = new Set<string>();

  for (const shift of shifts) {
    const localId = shift.employeeId ? employeeIdFor(shift.employeeId) : undefined;
    if (!localId) continue;

    const day = shiftToWorkDay(shift, localId);
    if (!day) continue;

    /* Personen räknas som täckt så snart TransPA sagt något om hen.
       Den som inte har ett enda pass lämnas otäckt och faller tillbaka
       på sitt lokala mönster — hellre det än att en tom vecka tolkas
       som ledighet och tömmer tavlan. */
    covered.add(localId);

    const key = `${day.employeeId}|${day.date}|${day.shift}`;
    if (seen.has(key)) continue;
    seen.add(key);
    workDays.push(day);
  }

  return { workDays, covered: [...covered] };
}
