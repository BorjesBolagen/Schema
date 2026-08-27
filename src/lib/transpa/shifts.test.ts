import { describe, expect, it } from "vitest";
import {
  attributeShifts,
  classifyShift,
  MAX_WINDOW_DAYS,
  SAMMA_PASS_LUCKA_MS,
  SHIFTS_PATH,
  shiftToWorkDay,
  shiftWindow,
  splitIntoWindows,
  workDaysForPerson,
  workDaysFromShifts,
} from "./shifts";

/**
 * Formen är bekräftad mot Börjes tenant, inte gissad: fälten kom ur ett
 * riktigt svar, och båda tidsgränserna visade sig obligatoriska.
 */
const shift = (startDateTime: string, employeeId = "T-1") => ({
  id: "s1",
  employeeId,
  startDateTime,
  adjustedWorkTimeInMinutes: 480,
  isExtraShift: false,
});

const local = (id: string) => (id === "T-1" ? "e1" : id === "T-2" ? "e2" : undefined);

describe("shiftWindow", () => {
  it("skickar båda gränserna, som API:t kräver", () => {
    const q = shiftWindow("2026-08-17", "2026-08-21");
    expect(Object.keys(q).sort()).toEqual(["startDateTimeAfter", "startDateTimeBefore"]);
  });

  /* API:t svarar 400 med "startDateTimeBefore has to be after
     startDateTimeAfter" när ordningen är fel. Det hände i skarp
     körning, och det får inte hända igen. */
  it("lägger den senare gränsen efter den tidigare", () => {
    const q = shiftWindow("2026-08-17", "2026-08-21");
    expect(new Date(q.startDateTimeBefore).getTime()).toBeGreaterThan(
      new Date(q.startDateTimeAfter).getTime(),
    );
  });

  it("håller ordningen även för en enda dag", () => {
    const q = shiftWindow("2026-08-17", "2026-08-17");
    expect(new Date(q.startDateTimeBefore).getTime()).toBeGreaterThan(
      new Date(q.startDateTimeAfter).getTime(),
    );
  });

  it("pekar på den bekräftade sökvägen, med snedstreck", () => {
    expect(SHIFTS_PATH).toBe("/v1/shifts/");
  });
});

describe("shiftToWorkDay", () => {
  it("läser dagen i svensk tid, inte i UTC", () => {
    /* 04:00Z är 06:00 svensk sommartid — samma dag, men bara för att
       tidszonen räknats om. Läst som UTC hade det blivit fel timme och
       därmed fel skift.

       Nattpassen prövas separat längre ned: de hör till kvällen de
       började, inte till morgonen de slutar. */
    expect(shiftToWorkDay(shift("2026-08-18T04:00:00Z"), "e1")).toEqual({
      employeeId: "e1",
      date: "2026-08-18",
      shift: "day",
    });
  });

  it("skiljer dagpass från nattpass", () => {
    // 05:00Z är 07:00 svensk sommartid, åtta timmar → slutar 15:00.
    expect(shiftToWorkDay(shift("2026-08-17T05:00:00Z"), "e1")!.shift).toBe("day");
    // 17:00Z är 19:00 här, åtta timmar → slutar 03:00. Natt.
    expect(shiftToWorkDay(shift("2026-08-17T17:00:00Z"), "e1")!.shift).toBe("night");
  });

  it("ger inget för ett pass utan starttid", () => {
    expect(shiftToWorkDay({ id: "s1", employeeId: "T-1" }, "e1")).toBeNull();
  });

  it("ger inget för en starttid som inte går att läsa", () => {
    expect(shiftToWorkDay(shift("inte ett datum"), "e1")).toBeNull();
  });
});

describe("workDaysFromShifts", () => {
  it("översätter TransPA:s person-id till vårt", () => {
    const { workDays } = workDaysFromShifts([shift("2026-08-17T06:00:00Z", "T-2")], local);
    expect(workDays[0].employeeId).toBe("e2");
  });

  it("hoppar över pass för någon vi inte känner", () => {
    const { workDays, covered } = workDaysFromShifts([shift("2026-08-17T06:00:00Z", "OKÄND")], local);
    expect(workDays).toEqual([]);
    expect(covered).toEqual([]);
  });

  /* Två pass samma dag och skift — delat pass eller extrapass — är
     fortfarande en arbetsdag. */
  it("räknar två pass samma dag och skift som en dag", () => {
    const { workDays } = workDaysFromShifts(
      [shift("2026-08-17T06:00:00Z"), shift("2026-08-17T10:00:00Z")],
      local,
    );
    expect(workDays).toHaveLength(1);
  });

  it("räknar dag och natt samma dygn som två", () => {
    const { workDays } = workDaysFromShifts(
      [shift("2026-08-17T06:00:00Z"), shift("2026-08-17T18:00:00Z")],
      local,
    );
    expect(workDays.map((w) => w.shift).sort()).toEqual(["day", "night"]);
  });

  /**
   * Täckningen avgör om reservkällan får ta över. Den som inte har ett
   * enda pass lämnas otäckt och faller tillbaka på sitt lokala mönster
   * — hellre det än att en tom vecka tolkas som ledighet och tömmer
   * tavlan för någon vars pass inte förts in i TransPA.
   */
  it("täcker bara dem TransPA faktiskt sagt något om", () => {
    const { covered } = workDaysFromShifts([shift("2026-08-17T06:00:00Z", "T-1")], local);
    expect(covered).toEqual(["e1"]);
  });

  it("tål en tom lista", () => {
    expect(workDaysFromShifts([], local)).toEqual({ workDays: [], covered: [] });
  });
});

/**
 * TransPA tar högst 31 dagar per anrop: "startDateTimeAfter and
 * startDateTimeBefore needs to be within 31 days". Synken bad om sexton
 * veckor och fick just det svaret.
 */
describe("splitIntoWindows", () => {
  const span = (w: { from: string; to: string }) =>
    (new Date(`${w.to}T00:00:00Z`).getTime() - new Date(`${w.from}T00:00:00Z`).getTime()) / 86_400_000;

  it("lämnar ett kort intervall i en bit", () => {
    expect(splitIntoWindows("2026-08-17", "2026-08-28")).toEqual([
      { from: "2026-08-17", to: "2026-08-28" },
    ]);
  });

  it("delar sexton veckor i bitar API:t accepterar", () => {
    const windows = splitIntoWindows("2026-08-01", "2026-11-21");

    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) expect(span(w)).toBeLessThan(31);
  });

  /* Ett glapp skulle tappa pass, ett överlapp skulle hämta dem två
     gånger. Bitarna ska gränsa exakt. */
  it("lämnar varken glapp eller överlapp", () => {
    const windows = splitIntoWindows("2026-08-01", "2026-11-21");

    for (let i = 1; i < windows.length; i++) {
      const föregåendeSlut = new Date(`${windows[i - 1].to}T00:00:00Z`).getTime();
      const dettaStart = new Date(`${windows[i].from}T00:00:00Z`).getTime();
      expect(dettaStart - föregåendeSlut).toBe(86_400_000);
    }
  });

  it("täcker hela intervallet, från första till sista dagen", () => {
    const windows = splitIntoWindows("2026-08-01", "2026-11-21");
    expect(windows[0].from).toBe("2026-08-01");
    expect(windows[windows.length - 1].to).toBe("2026-11-21");
  });

  it("klarar en enda dag", () => {
    expect(splitIntoWindows("2026-08-17", "2026-08-17")).toEqual([
      { from: "2026-08-17", to: "2026-08-17" },
    ]);
  });

  it("ger inget för ett bakvänt eller obegripligt intervall", () => {
    expect(splitIntoWindows("2026-08-28", "2026-08-17")).toEqual([]);
    expect(splitIntoWindows("inte ett datum", "2026-08-17")).toEqual([]);
  });

  it("håller sig under API:ts gräns med marginal", () => {
    expect(MAX_WINDOW_DAYS).toBeLessThan(31);
  });
});

/**
 * Börjes egna gränser: ett dagpass börjar tidigast 04 och slutar senast
 * 20. Ett nattpass börjar mellan 17 och midnatt. De överlappar mellan 17
 * och 20, och där avgör sluttiden.
 */
describe("classifyShift", () => {
  it("kallar ett vanligt dagpass för dag", () => {
    // Anders Johanssons faktiska pass: 07:00, tio timmar.
    expect(classifyShift(7, 600)).toBe("day");
    expect(classifyShift(6, 570)).toBe("day");
  });

  it("kallar ett pass som drar ut över 20 för natt när det börjat efter 17", () => {
    expect(classifyShift(18, 480)).toBe("night");
    expect(classifyShift(22, 480)).toBe("night");
  });

  /* Överlappet: samma starttimme, olika skift, för att sluttiden
     skiljer. Det är hela skälet till att längden behövs. */
  it("låter sluttiden avgöra i överlappet mellan 17 och 20", () => {
    expect(classifyShift(17, 180)).toBe("day"); // slutar 20:00
    expect(classifyShift(17, 480)).toBe("night"); // slutar 01:00
  });

  it("räknar timmarna före dagens början till natten", () => {
    expect(classifyShift(2, 480)).toBe("night");
    expect(classifyShift(0, 480)).toBe("night");
    expect(classifyShift(4, 480)).toBe("day");
  });

  /* Ett långt dagpass som drar över 20 är fortfarande ett dagpass — det
     började ju på morgonen. */
  it("kallar ett långt morgonpass för dag även när det drar över 20", () => {
    expect(classifyShift(7, 900)).toBe("day"); // slutar 22:00
  });

  it("går på starttiden ensam när längden saknas", () => {
    expect(classifyShift(7, null)).toBe("day");
    expect(classifyShift(18, undefined)).toBe("night");
  });
});

/**
 * Nattfolk dök upp två dagar i rad. Ett pass som slutade 06:00 på
 * tisdagen lades på tisdagen, bredvid måndagens natt — som om personen
 * kört två nätter. En natt är ett pass, och det hör till kvällen det
 * började.
 */
describe("natt över midnatt", () => {
  const at = (iso: string, minutes = 480) => ({
    id: "s1",
    employeeId: "T-1",
    startDateTime: iso,
    adjustedWorkTimeInMinutes: minutes,
  });

  it("lägger ett pass som börjar efter midnatt på gårdagens natt", () => {
    // 00:30 svensk sommartid tisdag är 22:30Z måndag.
    expect(shiftToWorkDay(at("2026-08-17T22:30:00Z"), "e1")).toEqual({
      employeeId: "e1",
      date: "2026-08-17",
      shift: "night",
    });
  });

  it("lägger kvällspasset på samma dag det började", () => {
    // 22:00 svensk tid måndag är 20:00Z.
    expect(shiftToWorkDay(at("2026-08-17T20:00:00Z"), "e1")).toEqual({
      employeeId: "e1",
      date: "2026-08-17",
      shift: "night",
    });
  });

  /* Det avgörande: kvällsdelen och morgondelen av samma natt ska landa
     på samma dag, så de slås ihop till en arbetsdag. */
  it("slår ihop kvällspasset och morgonpasset till en natt", () => {
    const { workDays } = workDaysFromShifts(
      [
        { ...at("2026-08-17T20:00:00Z", 240), id: "kvall" },
        { ...at("2026-08-17T22:30:00Z", 300), id: "morgon" },
      ],
      () => "e1",
    );

    expect(workDays).toEqual([{ employeeId: "e1", date: "2026-08-17", shift: "night" }]);
  });

  it("flyttar inte ett dagpass", () => {
    // 06:00 svensk tid är 04:00Z.
    expect(shiftToWorkDay(at("2026-08-18T04:00:00Z"), "e1")!.date).toBe("2026-08-18");
  });

  it("klarar månadsskifte", () => {
    // 01:00 svensk tid 1 september är 23:00Z 31 augusti.
    expect(shiftToWorkDay(at("2026-08-31T23:00:00Z"), "e1")!.date).toBe("2026-08-31");
  });
});


/**
 * Nattpass som TransPA delat i flera poster.
 *
 * Regeln som flyttar ett pass till gårdagen gick på starttimmen och
 * bara under 04. Den räckte för en svans som börjar 00:30, men inte för
 * en som börjar 04:30 — då blev svansen ett *dagpass på tisdagen*, och
 * nattchauffören stod som dagpersonal en dag hen sov. Det var det Johan
 * såg som "både dag och natt".
 *
 * Starttimmen ensam kan inte skilja fallen åt: ett äkta dagpass börjar
 * också 04:30. Det som skiljer är vilan före.
 */
describe("attributeShifts — delade nattpass", () => {
  /** Svensk sommartid är UTC+2, så lokal timme H är H-2 i Z. */
  const kl = (date: string, lokalTimme: number, minut = 0) =>
    `${date}T${String(lokalTimme - 2).padStart(2, "0")}:${String(minut).padStart(2, "0")}:00Z`;

  const pass = (id: string, iso: string, minutes: number) => ({
    id,
    employeeId: "T-1",
    startDateTime: iso,
    adjustedWorkTimeInMinutes: minutes,
  });

  it("håller ihop en natt vars svans börjar efter dagens gräns", () => {
    // 19:00–00:00 måndag, sedan 04:30–08:00 tisdag: ett pass, en natt.
    const dagar = attributeShifts(
      [
        pass("kvall", kl("2026-08-17", 19), 300),
        pass("morgon", kl("2026-08-18", 4, 30), 210),
      ],
      "e1",
    );

    expect(dagar.map((d) => d.day)).toEqual([
      { employeeId: "e1", date: "2026-08-17", shift: "night" },
      { employeeId: "e1", date: "2026-08-17", shift: "night" },
    ]);
    expect(workDaysForPerson(
      [pass("kvall", kl("2026-08-17", 19), 300), pass("morgon", kl("2026-08-18", 4, 30), 210)],
      "e1",
    )).toEqual([{ employeeId: "e1", date: "2026-08-17", shift: "night" }]);
  });

  it("håller ihop en natt vars svans börjar 05:00", () => {
    expect(
      workDaysForPerson(
        [pass("kvall", kl("2026-08-17", 20), 300), pass("morgon", kl("2026-08-18", 5), 120)],
        "e1",
      ),
    ).toEqual([{ employeeId: "e1", date: "2026-08-17", shift: "night" }]);
  });

  it("håller ihop den gamla varianten med svans före midnattsgränsen", () => {
    expect(
      workDaysForPerson(
        [pass("kvall", kl("2026-08-17", 19), 240), pass("morgon", kl("2026-08-18", 0, 30), 300)],
        "e1",
      ),
    ).toEqual([{ employeeId: "e1", date: "2026-08-17", shift: "night" }]);
  });

  /* Motprovet. Samma starttid som svansen ovan, men efter en hel natts
     vila — då är det ett riktigt dagpass och ska ligga på sin egen dag. */
  it("gör inte om ett äkta morgonpass till gårdagens natt", () => {
    expect(
      workDaysForPerson(
        [pass("dag1", kl("2026-08-17", 6), 540), pass("dag2", kl("2026-08-18", 4, 30), 480)],
        "e1",
      ),
    ).toEqual([
      { employeeId: "e1", date: "2026-08-17", shift: "day" },
      { employeeId: "e1", date: "2026-08-18", shift: "day" },
    ]);
  });

  it("läser passen i ordning även när de kommer omkastade", () => {
    expect(
      workDaysForPerson(
        [pass("morgon", kl("2026-08-18", 4, 30), 210), pass("kvall", kl("2026-08-17", 19), 300)],
        "e1",
      ),
    ).toEqual([{ employeeId: "e1", date: "2026-08-17", shift: "night" }]);
  });

  /* Kedjan får inte växa: tre korta pass i rad ska inte kunna svälja
     nästa dygn genom att ärva det första passets slut. */
  it("låter inte en kedja av korta pass svälja nästa dygn", () => {
    const dagar = workDaysForPerson(
      [
        pass("a", kl("2026-08-17", 19), 120),
        pass("b", kl("2026-08-17", 22), 120),
        pass("c", kl("2026-08-18", 7), 480),
      ],
      "e1",
    );

    expect(dagar).toEqual([
      { employeeId: "e1", date: "2026-08-17", shift: "night" },
      { employeeId: "e1", date: "2026-08-18", shift: "day" },
    ]);
  });

  /* Gränsen är ett val och ska inte kunna glida med en refaktorering.
     Den kläms mellan de två fall som faktiskt förekommer: svansen 04:30
     ska hänga ihop, morgonpasset 06:00 ska inte. */
  it("drar gränsen så att båda de verkliga fallen hamnar rätt", () => {
    // Kvällsdel 19:00–00:00. Sedan nästa pass efter olika långt uppehåll.
    const efter = (isoStart: string) =>
      workDaysForPerson(
        [pass("kvall", kl("2026-08-17", 19), 300), pass("nasta", isoStart, 240)],
        "e1",
      ).length;

    expect(efter(kl("2026-08-18", 4, 30))).toBe(1); // 4,5 h — samma natt
    expect(efter(kl("2026-08-18", 6))).toBe(2); // 6 h — eget dygn
    expect(SAMMA_PASS_LUCKA_MS).toBe(5 * 60 * 60 * 1000);
  });

  /* Delar TransPA inte nätterna ska ingenting ändras. */
  it("rör inte ensamma pass", () => {
    expect(workDaysForPerson([pass("natt", kl("2026-08-17", 19), 540)], "e1")).toEqual([
      { employeeId: "e1", date: "2026-08-17", shift: "night" },
    ]);
  });

  it("hoppar över pass utan starttid", () => {
    expect(
      workDaysForPerson(
        [{ id: "x", employeeId: "T-1", startDateTime: null } as never, pass("natt", kl("2026-08-17", 19), 540)],
        "e1",
      ),
    ).toEqual([{ employeeId: "e1", date: "2026-08-17", shift: "night" }]);
  });
});
