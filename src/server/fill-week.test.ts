import { describe, expect, it } from "vitest";
import { planWeek, type BaseScheduleEntry, type ExistingAssignment } from "./fill-week";
import type { WorkDay } from "@/lib/work-days";

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
const [MON, TUE, WED, THU, FRI] = WEEK;

/* id räknas upp av sig självt: de flesta testerna bryr sig inte om det,
   men planWeek behöver ett stabilt sista utslag när två rader är lika. */
let nextId = 0;
function base(
  over: Partial<BaseScheduleEntry> & Pick<BaseScheduleEntry, "boardRowId" | "employeeId">,
): BaseScheduleEntry {
  return {
    id: `bs${++nextId}`,
    cycleLength: 1,
    cycleOffset: 0,
    validFrom: null,
    validTo: null,
    sortOrder: 0,
    ...over,
  };
}

const work = (employeeId: string, dates: string[], shift: WorkDay["shift"] = "day"): WorkDay[] =>
  dates.map((date) => ({ employeeId, date, shift }));

describe("planWeek", () => {
  /**
   * Fallet ur era fjärrblad: BT13/14 körs av Björn måndag, tisdag,
   * torsdag, fredag och av Roger onsdag. Ingen har skrivit in det per
   * dag — båda är kopplade till bilen och deras arbetsdagar avgör.
   */
  it("bemannar en bil av två personer utifrån deras arbetsdagar", () => {
    const plan = planWeek({
      workDays: [...work("bjorn", [MON, TUE, THU, FRI]), ...work("roger", [WED])],
      baseSchedule: [
        base({ boardRowId: "bt1314", employeeId: "bjorn" }),
        base({ boardRowId: "bt1314", employeeId: "roger" }),
      ],
      existing: [],
      dates: WEEK,
    });

    expect(plan.create.map((c) => [c.date, c.employeeId])).toEqual([
      [MON, "bjorn"],
      [TUE, "bjorn"],
      [WED, "roger"],
      [THU, "bjorn"],
      [FRI, "bjorn"],
    ]);
    expect(plan.create.every((c) => c.boardRowId === "bt1314" && c.slot === 0)).toBe(true);
    expect(plan.unplaced).toEqual([]);
  });

  it("håller dag- och nattpass isär", () => {
    const plan = planWeek({
      workDays: [...work("elin", [MON], "day"), ...work("peter", [MON], "night")],
      baseSchedule: [
        base({ boardRowId: "bt0809", employeeId: "elin" }),
        base({ boardRowId: "bt0809", employeeId: "peter" }),
      ],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create).toEqual([
      { boardRowId: "bt0809", date: MON, shift: "day", slot: 0, employeeId: "elin" },
      { boardRowId: "bt0809", date: MON, shift: "night", slot: 0, employeeId: "peter" },
    ]);
  });

  it("listar den som jobbar men saknar bil", () => {
    const plan = planWeek({
      workDays: work("max", [MON, TUE]),
      baseSchedule: [],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create).toEqual([]);
    expect(plan.unplaced).toEqual([
      { employeeId: "max", date: MON, shift: "day" },
      { employeeId: "max", date: TUE, shift: "day" },
    ]);
  });

  it("respekterar bas-schemats giltighetsperiod", () => {
    const plan = planWeek({
      workDays: work("bjorn", [MON, WED, FRI]),
      baseSchedule: [
        base({ boardRowId: "gammal", employeeId: "bjorn", validTo: TUE }),
        base({ boardRowId: "ny", employeeId: "bjorn", validFrom: WED }),
      ],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create.map((c) => [c.date, c.boardRowId])).toEqual([
      [MON, "gammal"],
      [WED, "ny"],
      [FRI, "ny"],
    ]);
  });

  describe("handpåläggning", () => {
    const manualOnTue: ExistingAssignment = {
      id: "m1",
      boardRowId: "bt2426",
      date: TUE,
      shift: "day",
      slot: 0,
      employeeId: "bjorn",
      source: "manual",
    };

    it("rör inte ett pass som någon flyttat för hand", () => {
      const plan = planWeek({
        workDays: work("bjorn", [MON, TUE]),
        baseSchedule: [base({ boardRowId: "bt1314", employeeId: "bjorn" })],
        existing: [manualOnTue],
        dates: WEEK,
      });
      // Tisdagen står kvar där planeraren satte den, bara måndagen genereras.
      expect(plan.deleteIds).toEqual([]);
      expect(plan.create.map((c) => [c.date, c.boardRowId])).toEqual([[MON, "bt1314"]]);
    });

    it("lägger genererade pass bredvid ett handpålagt i samma cell", () => {
      const plan = planWeek({
        workDays: work("roger", [TUE]),
        baseSchedule: [base({ boardRowId: "bt2426", employeeId: "roger" })],
        existing: [manualOnTue],
        dates: WEEK,
      });
      expect(plan.create[0].slot).toBe(1);
    });

    it("städar bort sina egna gamla pass men inte andras", () => {
      const stale: ExistingAssignment = {
        id: "g1",
        boardRowId: "bt1314",
        date: MON,
        shift: "day",
        slot: 0,
        employeeId: "bjorn",
        source: "generated",
      };
      const plan = planWeek({
        workDays: [],
        baseSchedule: [],
        existing: [stale, manualOnTue],
        dates: WEEK,
      });
      expect(plan.deleteIds).toEqual(["g1"]);
    });
  });

  it("ger samma resultat två körningar i rad", () => {
    const args = {
      workDays: [...work("bjorn", [MON, TUE, THU, FRI]), ...work("roger", [WED])],
      baseSchedule: [
        base({ boardRowId: "bt1314", employeeId: "bjorn" }),
        base({ boardRowId: "bt1314", employeeId: "roger" }),
      ],
      dates: WEEK,
    };
    const first = planWeek({ ...args, existing: [] });

    // Andra körningen ser resultatet av den första som genererade pass.
    const asExisting: ExistingAssignment[] = first.create.map((c, i) => ({
      id: `g${i}`,
      boardRowId: c.boardRowId,
      date: c.date,
      shift: c.shift,
      slot: c.slot,
      employeeId: c.employeeId,
      source: "generated",
    }));
    const second = planWeek({ ...args, existing: asExisting });

    expect(second.create).toEqual(first.create);
    expect(second.deleteIds.sort()).toEqual(asExisting.map((a) => a.id).sort());
  });

  it("bryr sig inte om arbetsdagar utanför veckan", () => {
    const plan = planWeek({
      workDays: work("bjorn", ["2026-08-10", MON]),
      baseSchedule: [base({ boardRowId: "bt1314", employeeId: "bjorn" })],
      existing: [],
      dates: WEEK,
    });
    expect(plan.create.map((c) => c.date)).toEqual([MON]);
  });
});

describe("frånvaro", () => {
  it("bemannar inte den som är ledig, och kallar hen inte ej utlagd", () => {
    const plan = planWeek({
      workDays: work("johan", [MON, TUE, WED]),
      baseSchedule: [base({ boardRowId: "bt2426", employeeId: "johan" })],
      existing: [],
      absences: [{ employeeId: "johan", fromDate: TUE, toDate: WED }],
      dates: WEEK,
    });
    expect(plan.create.map((c) => c.date)).toEqual([MON]);
    expect(plan.unplaced).toEqual([]);
  });
});

/**
 * Det som var tyst fel.
 *
 * En person kopplad till två bilar hamnade på en av dem, vald ur en
 * osorterad databasläsning. Valet kunde alltså bli olika mellan två
 * tryck på "Fyll veckan" — personen bytte bil av sig själv, och den
 * andra bilen stod plötsligt obemannad utan att något sagt ifrån.
 */
describe("planWeek när flera bas-schemarader gäller", () => {
  const tva = () => [
    base({ id: "b-hog", boardRowId: "BT13", employeeId: "e1", sortOrder: 1 }),
    base({ id: "a-lag", boardRowId: "BT24", employeeId: "e1", sortOrder: 0 }),
  ];

  it("väljer den med lägst sortOrder, oavsett läsordning", () => {
    const framat = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: tva(),
      existing: [],
      dates: WEEK,
    });
    const bakat = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: tva().reverse(),
      existing: [],
      dates: WEEK,
    });

    expect(framat.create[0].boardRowId).toBe("BT24");
    expect(bakat.create[0].boardRowId).toBe("BT24");
  });

  it("nämner inget om tvetydighet när sortOrder skiljer dem åt", () => {
    expect(
      planWeek({ workDays: work("e1", [MON]), baseSchedule: tva(), existing: [], dates: WEEK })
        .ambiguous,
    ).toEqual([]);
  });

  /* Lika sortOrder betyder att ingen sagt vilken som gäller. Valet ska
     ändå vara detsamma varje gång — och det ska sägas ifrån. */
  it("väljer likadant varje gång när sortOrder är lika", () => {
    const lika = () => [
      base({ id: "z", boardRowId: "BT24", employeeId: "e1" }),
      base({ id: "a", boardRowId: "BT13", employeeId: "e1" }),
    ];
    const ett = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: lika(),
      existing: [],
      dates: WEEK,
    });
    const tva_ = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: lika().reverse(),
      existing: [],
      dates: WEEK,
    });

    expect(ett.create[0].boardRowId).toBe(tva_.create[0].boardRowId);
  });

  it("pekar ut tvetydigheten i stället för att gissa tyst", () => {
    const plan = planWeek({
      workDays: work("e1", [MON]),
      baseSchedule: [
        base({ id: "a", boardRowId: "BT13", employeeId: "e1" }),
        base({ id: "z", boardRowId: "BT24", employeeId: "e1" }),
      ],
      existing: [],
      dates: WEEK,
    });

    expect(plan.ambiguous).toEqual([
      { employeeId: "e1", date: MON, shift: "day", chosen: "BT13", alternatives: ["BT24"] },
    ]);
  });
});

describe("planWeek respekterar tavlan och raderna", () => {
  it("bemannar inte en rad som är inställd den dagen", () => {
    const plan = planWeek({
      workDays: work("e1", [MON, TUE]),
      baseSchedule: [base({ boardRowId: "BT13", employeeId: "e1" })],
      existing: [],
      rows: [{ id: "BT13", validFrom: null, validTo: MON }],
      dates: WEEK,
    });

    expect(plan.create.map((c) => c.date)).toEqual([MON]);
    // Tisdagen är inte en lucka i bemanningen — raden fanns inte då.
    expect(plan.unplaced.map((u) => u.date)).toEqual([TUE]);
  });

  /* Ett nattpass på en dagtavla har ingen cell att ligga i. Att lägga ut
     det ändå ger en rad i databasen som aldrig syns. */
  it("lägger inte ut ett skift tavlan inte visar", () => {
    const plan = planWeek({
      workDays: [...work("e1", [MON]), ...work("e1", [TUE], "night")],
      baseSchedule: [
        /* En koppling räcker för båda skiften — kopplingen säger
           vilken bil, passet säger när. */
        base({ boardRowId: "BT13", employeeId: "e1" }),
      ],
      existing: [],
      visibleShifts: ["day"],
      dates: WEEK,
    });

    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].shift).toBe("day");
    expect(plan.hiddenShift).toEqual([{ employeeId: "e1", date: TUE, shift: "night" }]);
  });

  it("lägger ut båda skiften när tavlan visar dem", () => {
    const plan = planWeek({
      workDays: [...work("e1", [MON]), ...work("e1", [TUE], "night")],
      baseSchedule: [
        /* En koppling räcker för båda skiften — kopplingen säger
           vilken bil, passet säger när. */
        base({ boardRowId: "BT13", employeeId: "e1" }),
      ],
      existing: [],
      visibleShifts: ["day", "night"],
      dates: WEEK,
    });

    expect(plan.create).toHaveLength(2);
    expect(plan.hiddenShift).toEqual([]);
  });
});

/**
 * De tre rotationsformerna Johan beskrev.
 *
 * Alla tre ryms i samma modell: varje koppling bär sin egen cykellängd,
 * och säger vilka veckodagar och vilka cykelveckor den
 * gäller. Tomt betyder alla, så en stående koppling är oförändrad.
 */
describe("planWeek med rotation", () => {
  /* 1. Olika bilar olika dagar, likadant varje vecka. */
  it("kopplar olika bilar till olika veckodagar", () => {
    const plan = planWeek({
      workDays: work("e1", [MON, TUE, WED, THU]),
      baseSchedule: [
        base({ boardRowId: "BT13", employeeId: "e1", weekdays: [2, 4] }), // tis, tors
        base({ boardRowId: "BT24", employeeId: "e1", weekdays: [1, 3] }), // mån, ons
      ],
      existing: [],
      dates: WEEK,
    });

    expect(plan.create.map((c) => [c.date, c.boardRowId])).toEqual([
      [MON, "BT24"],
      [TUE, "BT13"],
      [WED, "BT24"],
      [THU, "BT13"],
    ]);
  });

  /* 2. Olika bilar olika veckor. */
  it("byter bil mellan cykelveckor", () => {
    const schema = [
      base({ boardRowId: "BT13", employeeId: "e1", cycleLength: 4, cycleWeeks: [1, 2] }),
      base({ boardRowId: "BT24", employeeId: "e1", cycleLength: 4, cycleWeeks: [3, 4] }),
    ];
    const bilen = (position: number) =>
      planWeek({
        workDays: work("e1", [MON]),
        baseSchedule: schema,
        existing: [],
        isoWeek: position,
        dates: WEEK,
      }).create[0]?.boardRowId;

    expect([1, 2, 3, 4].map(bilen)).toEqual(["BT13", "BT13", "BT24", "BT24"]);
  });

  /* 3. Fyra veckors rotation med olika bilar olika dagar inom cykeln. */
  it("klarar olika bilar olika dagar inom en fyraveckorscykel", () => {
    const schema = [
      base({ boardRowId: "BT13", employeeId: "e1", cycleLength: 2, cycleWeeks: [1], weekdays: [1, 2] }),
      base({ boardRowId: "BT24", employeeId: "e1", cycleLength: 2, cycleWeeks: [1], weekdays: [3, 4] }),
      base({ boardRowId: "BT50", employeeId: "e1", cycleLength: 2, cycleWeeks: [2] }),
    ];
    const veckan = (position: number) =>
      planWeek({
        workDays: work("e1", [MON, TUE, WED, THU]),
        baseSchedule: schema,
        existing: [],
        isoWeek: position,
        dates: WEEK,
      }).create.map((c) => c.boardRowId);

    expect(veckan(1)).toEqual(["BT13", "BT13", "BT24", "BT24"]);
    expect(veckan(2)).toEqual(["BT50", "BT50", "BT50", "BT50"]);
  });

  /* Poängen med specificitet: ett undantag ska kunna läggas ovanpå en
     stående koppling utan att huvudregeln skrivs om. */
  it("låter en mer preciserad koppling slå den stående", () => {
    const plan = planWeek({
      workDays: work("e1", [MON, TUE]),
      baseSchedule: [
        base({ boardRowId: "BT13", employeeId: "e1" }), // alltid
        base({ boardRowId: "BT24", employeeId: "e1", weekdays: [2] }), // utom tisdagar
      ],
      existing: [],
      dates: WEEK,
    });

    expect(plan.create.map((c) => [c.date, c.boardRowId])).toEqual([
      [MON, "BT13"],
      [TUE, "BT24"],
    ]);
    // Det är inget tvetydigt: den ena är uttryckligen snävare.
    expect(plan.ambiguous).toEqual([]);
  });

  it("lämnar en stående koppling oförändrad", () => {
    const plan = planWeek({
      workDays: work("e1", [MON, TUE]),
      baseSchedule: [base({ boardRowId: "BT13", employeeId: "e1" })],
      existing: [],
      isoWeek: 3,
      dates: WEEK,
    });

    expect(plan.create).toHaveLength(2);
    expect(plan.create.every((c) => c.boardRowId === "BT13")).toBe(true);
  });

  it("räknar personen som ej utlagd när ingen koppling gäller den dagen", () => {
    const plan = planWeek({
      workDays: work("e1", [MON, TUE]),
      baseSchedule: [base({ boardRowId: "BT13", employeeId: "e1", weekdays: [2] })],
      existing: [],
      dates: WEEK,
    });

    expect(plan.create.map((c) => c.date)).toEqual([TUE]);
    expect(plan.unplaced.map((u) => u.date)).toEqual([MON]);
  });
});

/**
 * Fallet som inte gick att skriva ned.
 *
 * En förare i fyraveckorscykel:
 *
 *   vecka 1: fyra nattpass
 *   vecka 2: fyra nattpass
 *   vecka 3: ett nattpass, två dagpass
 *   vecka 4: tre dagpass
 *
 * Med skift i kopplingen behövdes en koppling per skift, och vecka 3
 * krävde två kopplingar till *samma* bil som bara skilde sig på dag
 * eller natt. Ingen av dem var fel, så valet mellan dem blev godtyckligt
 * — och personen hamnade på båda skiften varje vecka.
 *
 * Nu säger kopplingen bara vilken bil. Vilket skift ett pass är vet
 * TransPA av tiderna.
 */
describe("blandade skift i en rotation", () => {
  const koppling = base({ boardRowId: "BT13", employeeId: "e1", cycleLength: 4 });

  const kör = (isoWeek: number, workDays: WorkDay[]) =>
    planWeek({
      workDays,
      baseSchedule: [koppling],
      existing: [],
      visibleShifts: ["day", "night"],
      isoWeek,
      dates: WEEK,
    });

  it("lägger nattveckorna på nattraden", () => {
    for (const vecka of [1, 2]) {
      const plan = kör(vecka, work("e1", [MON, TUE, WED, THU], "night"));
      expect(plan.create).toHaveLength(4);
      expect(plan.create.every((c) => c.shift === "night")).toBe(true);
      expect(plan.create.every((c) => c.boardRowId === "BT13")).toBe(true);
    }
  });

  /* Veckan som var omöjlig: samma bil, samma person, båda skiften. */
  it("klarar en vecka med både natt och dag på samma bil", () => {
    const plan = kör(3, [...work("e1", [MON], "night"), ...work("e1", [WED, THU], "day")]);

    expect(plan.create.map((c) => [c.date, c.shift])).toEqual([
      [MON, "night"],
      [WED, "day"],
      [THU, "day"],
    ]);
    expect(plan.unplaced).toEqual([]);
    /* Och ingen gissning: det finns bara en koppling, den om bilen. */
    expect(plan.ambiguous).toEqual([]);
  });

  it("lägger dagveckan på dagraden", () => {
    const plan = kör(4, work("e1", [TUE, WED, THU], "day"));
    expect(plan.create).toHaveLength(3);
    expect(plan.create.every((c) => c.shift === "day")).toBe(true);
  });

  /* Ingen dubblering: en person med ett nattpass ska inte också dyka
     upp på dagraden bara för att kopplingen inte längre nämner skift. */
  it("lägger ut ett pass en gång, på sitt eget skift", () => {
    const plan = kör(1, work("e1", [MON], "night"));
    expect(plan.create).toEqual([
      { boardRowId: "BT13", date: MON, shift: "night", slot: 0, employeeId: "e1" },
    ]);
  });
});

/**
 * Cykeln per koppling, inte per tavla.
 *
 * Två personer på samma tavla kan gå i olika cykler, och samma person
 * kan gå i olika cykler på olika bilar. Det var inte möjligt när
 * längden satt på tavlan — och att det inte var möjligt syntes inte,
 * eftersom fältet fanns och tog emot ett värde.
 */
describe("cykler sida vid sida", () => {
  it("låter två personer på samma tavla ha olika cykellängd", () => {
    const schema = [
      // Varje vecka.
      base({ boardRowId: "BT13", employeeId: "varje" }),
      // Varannan vecka, de udda.
      base({ boardRowId: "BT24", employeeId: "varannan", cycleLength: 2, cycleWeeks: [1] }),
    ];
    const kör = (isoWeek: number) =>
      planWeek({
        workDays: [...work("varje", [MON]), ...work("varannan", [MON])],
        baseSchedule: schema,
        existing: [],
        isoWeek,
        dates: WEEK,
      });

    /* Udda ISO-vecka: båda kör. Jämn: bara den som kör varje vecka,
       och den andra räknas som ej utlagd i stället för att tyst
       försvinna. */
    expect(kör(1).create.map((c) => c.employeeId).sort()).toEqual(["varannan", "varje"]);
    expect(kör(2).create.map((c) => c.employeeId)).toEqual(["varje"]);
    expect(kör(2).unplaced.map((u) => u.employeeId)).toEqual(["varannan"]);
  });

  it("låter samma person ha olika cykler på olika bilar", () => {
    const schema = [
      // Varannan vecka på BT13.
      base({ boardRowId: "BT13", employeeId: "e1", cycleLength: 2, cycleWeeks: [1] }),
      // Var fjärde vecka på BT24, och bara vecka 4 i den cykeln.
      base({ boardRowId: "BT24", employeeId: "e1", cycleLength: 4, cycleWeeks: [4] }),
    ];
    const bilen = (isoWeek: number) =>
      planWeek({
        workDays: work("e1", [MON]),
        baseSchedule: schema,
        existing: [],
        isoWeek,
        dates: WEEK,
      }).create[0]?.boardRowId;

    expect(bilen(1)).toBe("BT13"); // udda vecka
    expect(bilen(3)).toBe("BT13"); // udda igen
    expect(bilen(4)).toBe("BT24"); // jämn, och fjärde i sin cykel
    expect(bilen(2)).toBeUndefined(); // jämn men inte fjärde: ingen bil
  });

  /* Förskjutningen finns för att numreringen ska gå att ställa mot den
     planeraren redan använder. Värnamobladet börjar inte på 1. */
  it("förskjuter cykeln", () => {
    const utan = base({ boardRowId: "A", employeeId: "e1", cycleLength: 4, cycleWeeks: [1] });
    const med = base({
      boardRowId: "B",
      employeeId: "e2",
      cycleLength: 4,
      cycleWeeks: [1],
      cycleOffset: 2,
    });
    const kör = (isoWeek: number) =>
      planWeek({
        workDays: [...work("e1", [MON]), ...work("e2", [MON])],
        baseSchedule: [utan, med],
        existing: [],
        isoWeek,
        dates: WEEK,
      }).create.map((c) => c.employeeId);

    expect(kör(1)).toEqual(["e1"]); // utan förskjutning träffar vecka 1
    expect(kör(3)).toEqual(["e2"]); // med förskjutning 2 träffar vecka 3
  });
});
