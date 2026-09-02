import { describe, expect, it, beforeEach } from "vitest";
import { probeTenant } from "./transpa-probe";
import { CHECKS, checkById } from "@/lib/transpa/checks";
import { clearTokenCache } from "@/lib/transpa/auth";

const env = {
  TRANSPA_CLIENT_ID: "id",
  TRANSPA_CLIENT_SECRET: "hemlis",
  TRANSPA_TENANT_ID: "t1",
};

/** Fejkar både token-endpointen, specen och API:t. */
function fakeFetch(handler: (url: string) => Response) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("connect/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }));
    }
    /* Specen lämnas åt handtaget när det vill svara på den; annars
       låtsas den saknas, som i de flesta testerna. */
    if (url.includes("doc/openapi")) {
      const own = handler(url);
      return own.status === 404 && !own.headers.get("x-handled") ? new Response("", { status: 404 }) : own;
    }
    return handler(url);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearTokenCache();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
});

describe("probeTenant", () => {
  it("visar fältnamnen i första raden för /v1/trips utan att röra värdena", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("/v1/trips")) {
        return new Response(
          JSON.stringify({
            items: [{ id: "t1", employeeId: "e1", vehicleId: "v1", startDateTime: "2026-01-01" }],
            cursor: { nextToken: null },
          }),
        );
      }
      return new Response(JSON.stringify({ items: [], cursor: { nextToken: null } }));
    });

    const report = await probeTenant(fetchImpl);
    const trips = report.endpoints.find((e) => e.path === "/v1/trips")!;

    expect(trips.outcome).toBe("ok");
    expect(trips.sampleKeys).toEqual(["employeeId", "id", "startDateTime", "vehicleId"]);
    // Vilken nyckel raderna låg under redovisas i stället för att antas.
    expect(trips.rowKey).toBe("items");
    expect(trips.sample).toBe(1);
    // Bara fältnamnen — inget av värdena "t1", "e1" osv i utdatat.
    expect(JSON.stringify(trips)).not.toContain("e1");
  });

  it("lämnar sampleKeys osatt för endpoints utanför listan, och tomt när svaret är tomt", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ items: [], cursor: { nextToken: null } })));
    const report = await probeTenant(fetchImpl);

    const trips = report.endpoints.find((e) => e.path === "/v1/trips")!;
    expect(trips.outcome).toBe("empty");
    expect(trips.sampleKeys).toEqual([]);

    /* stationPlaces stod här förut, men den visar numera fältnamn —
       poängen är en väg som avsiktligt står utanför listan. */
    const alive = report.endpoints.find((e) => e.path === "/v1/alive")!;
    expect(alive.sampleKeys).toBeUndefined();
  });
});

describe("jakten på passen", () => {
  it("hittar passen under en person och använder ett riktigt id", async () => {
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      const path = new URL(url).pathname;
      sedda.push(path);
      if (path.endsWith("/v1/employees")) {
        return new Response(
          JSON.stringify({ items: [{ id: "emp-42", firstName: "A" }], cursor: { nextToken: null } }),
        );
      }
      // Bara underresursen finns — precis som i verkligheten, där
      /* Snedstrecket är rutten: /v1/shifts svarar 404, /v1/shifts/ finns.
         Det var därför passen inte gick att hitta på flera dagar. */
      if (path === "/publicApi/v1/employees/emp-42/shifts/") {
        return new Response(
          JSON.stringify({ items: [{ date: "2026-08-24", startTime: "06:00" }], cursor: {} }),
        );
      }
      return new Response(JSON.stringify({ title: "Not found" }), { status: 404 });
    });

    const report = await probeTenant(fetchImpl);
    const träff = report.endpoints.find((e) => e.path === "/v1/employees/emp-42/shifts/");

    expect(träff?.outcome).toBe("ok");
    // Id:t ska komma från personallistan, inte vara påhittat.
    expect(sedda).toContain("/publicApi/v1/employees/emp-42/shifts/");
  });

  it("anropar aldrig en väg med platshållaren kvar", async () => {
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      sedda.push(new URL(url).pathname);
      return new Response(JSON.stringify({ items: [], cursor: {} }));
    });

    const report = await probeTenant(fetchImpl);
    // Raden syns, men vägen anropas inte: en 404 på "{id}" betyder inget.
    expect(sedda.some((p) => p.includes("{id}"))).toBe(false);
    const kvar = report.endpoints.find((e) => e.path.includes("{id}"));
    expect(kvar?.outcome).toBe("not-run");
    expect(kvar?.detail).toMatch(/inget person-id/i);
  });
});

describe("person-id ur svaret", () => {
  it("hittar id:t även när fälten är PascalCase", async () => {
    // Vismas genererade klient är PascalCase (Id, FirstName). Antar man
    // camelCase blir id:t null, underresurserna provas aldrig, och
    // raderna såg tidigare ut att inte ens finnas.
    const sedda: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      const path = new URL(url).pathname;
      sedda.push(path);
      if (path.endsWith("/v1/employees")) {
        return new Response(
          JSON.stringify({
            items: [{ Id: "PASCAL-1", FirstName: "A", LastName: "B" }],
            cursor: { nextToken: null },
          }),
        );
      }
      return new Response(JSON.stringify({ title: "Not found" }), { status: 404 });
    });

    const report = await probeTenant(fetchImpl);
    expect(report.employeeSample?.id).toBe("PASCAL-1");
    expect(report.employeeSample?.keys).toContain("Id");
    expect(sedda).toContain("/publicApi/v1/employees/PASCAL-1/shifts/");
  });

  it("listar underresurserna även när inget id gick att plocka ut", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ items: [], cursor: {} })));
    const report = await probeTenant(fetchImpl);

    expect(report.employeeSample?.id).toBeNull();
    // Raden ska finnas kvar, med platshållaren synlig — att den tyst
    // försvann gjorde det omöjligt att se att den aldrig provades.
    expect(report.endpoints.some((e) => e.path.includes("{id}"))).toBe(true);
  });
});

describe("samma vägar redovisas oavsett hur långt körningen kom", () => {
  it("listar pass-kandidaterna även när token-hämtningen misslyckas", async () => {
    // Tidigare byggdes listan på två ställen, och den här vägen saknade
    // pass-kandidaterna helt — de såg ut att inte finnas.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("connect/token")) {
        return new Response("nej", { status: 401 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const report = await probeTenant(fetchImpl);
    expect(report.token.outcome).not.toBe("ok");
    expect(report.endpoints.some((e) => e.label === "Pass under en person")).toBe(true);
    expect(report.endpoints.every((e) => e.outcome === "not-run")).toBe(true);
  });

  /* 200 med en form vi inte känner igen är inte "tomt svar". Det var
     precis så /v1/employees såg ut när raderna låg under items och
     koden läste data: sidan sa att svaret saknade fält. */
  it("skiljer okänt kuvert från tomt svar", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ result: [{ id: "x" }] })));
    const report = await probeTenant(fetchImpl);
    const employees = report.endpoints.find((e) => e.path === "/v1/employees")!;

    expect(employees.outcome).toBe("error");
    expect(employees.status).toBe(200);
    expect(employees.detail).toMatch(/varken items eller data/);
  });
});

/**
 * Fönsterfrågan mot /v1/trips avgör om arbetsdagarna går att hämta
 * från TransPA alls. Svaret ska följa av vad API:t returnerar, inte av vad vi
 * hoppas.
 */
describe("turer: planerade eller körda", () => {
  const trip = (startDateTime: string, status: string) => ({
    id: "x",
    employeeId: "e1",
    startDateTime,
    status,
  });

  /** Skiljer fönstren åt på gte-gränsen i filtret. */
  const windowed = (future: unknown[], past: unknown[]) =>
    fakeFetch((url) => {
      if (!url.includes("/v1/trips")) {
        return new Response(JSON.stringify({ items: [], cursor: {} }));
      }
      const filter = decodeURIComponent(new URL(url).searchParams.get("filter") ?? "");
      const from = filter.split("$gte:")[1]?.split("$and:")[0] ?? "";
      const isPast = new Date(from).getTime() < Date.now() - 1000;
      return new Response(JSON.stringify({ items: isPast ? past : future, cursor: {} }));
    });

  it("säger planerade när det finns turer framåt", async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const report = await probeTenant(windowed([trip(soon, "planned")], []));

    expect(report.trips?.verdict).toBe("planerade");
    expect(report.trips?.future?.rows).toBe(1);
  });

  it("säger bara-körda när det bara finns turer bakåt", async () => {
    const then = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const report = await probeTenant(windowed([], [trip(then, "approved")]));

    expect(report.trips?.verdict).toBe("bara-korda");
    expect(report.trips?.past?.statuses).toEqual(["approved"]);
  });

  /**
   * Antalet turer säger inget utan fördelningen. Femton turer kan vara
   * tre personer som kör fem dagar var — eller femton personer med en
   * resa var, vilket betyder att en tur inte är ett arbetspass.
   */
  it("räknar hur många personer turerna fördelar sig på", async () => {
    const then = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const many = ["a", "b", "c"].flatMap((who) => [
      { ...trip(then, "approved"), employeeId: who },
      { ...trip(then, "approved"), employeeId: who },
    ]);
    const report = await probeTenant(windowed([], many));

    expect(report.trips?.past?.rows).toBe(6);
    expect(report.trips?.past?.employees).toBe(3);
  });

  it("räknar personen en gång även med många turer", async () => {
    const then = new Date(Date.now() - 86_400_000).toISOString();
    const same = Array.from({ length: 8 }, () => ({ ...trip(then, "approved"), employeeId: "a" }));
    const report = await probeTenant(windowed([], same));

    expect(report.trips?.past?.rows).toBe(8);
    expect(report.trips?.past?.employees).toBe(1);
  });

  it("säger inga-turer när fönstren är tomma", async () => {
    const report = await probeTenant(windowed([], []));
    expect(report.trips?.verdict).toBe("inga-turer");
  });

  /* employeeId och tiderna pekar ut enskilda personers arbetspass och
     får inte lämna servern — bara antal och status redovisas. */
  it("släpper aldrig ut employeeId eller tider", async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const report = await probeTenant(windowed([trip(soon, "planned")], []));

    expect(JSON.stringify(report.trips)).not.toContain("e1");
    expect(JSON.stringify(report.trips)).not.toContain(soon);
  });
});

/**
 * Frågan sonden ska svara på: går stationsorten att härleda ur något
 * fält TransPA redan skickar, eller måste 301 personer få den för hand?
 */
describe("gruppfälten mot stationsorterna", () => {
  const person = (grouping: unknown, professionGroup: unknown = "Chaufför") => ({
    id: "e1",
    firstName: "A",
    grouping,
    professionGroup,
  });

  const withPeople = (people: unknown[], stations: string[]) =>
    fakeFetch((url) => {
      if (url.includes("/v1/stationPlaces")) {
        return new Response(
          JSON.stringify({ items: stations.map((name, i) => ({ id: `s${i}`, name })), cursor: {} }),
        );
      }
      if (url.includes("/v1/employees")) {
        return new Response(JSON.stringify({ items: people, cursor: {} }));
      }
      return new Response(JSON.stringify({ items: [], cursor: {} }));
    });

  it("ser att fältet är orten när värdena matchar", async () => {
    const report = await probeTenant(
      withPeople(
        [person("Nybro"), person("Nybro"), person("Hultsfred")],
        ["Nybro", "Hultsfred", "Gävle"],
      ),
    );
    const g = report.grouping!.fields.find((f) => f.field === "grouping")!;

    expect(g.distinct).toBe(2);
    expect(g.matchesStation).toBe(2);
    expect(g.values[0]).toEqual({ value: "Nybro", count: 2 });
  });

  it("ser att fältet är något annat när det inte matchar", async () => {
    const report = await probeTenant(withPeople([person("Fjärr"), person("Distribution")], ["Nybro"]));
    const g = report.grouping!.fields.find((f) => f.field === "grouping")!;

    expect(g.matchesStation).toBe(0);
  });

  /* "nybro " och "Nybro" är samma ort. Utan normaliseringen skulle ett
     efterföljande mellanslag få det att se ut som att fältet inte
     matchade alls. */
  it("bryr sig inte om skiftläge eller mellanslag", async () => {
    const report = await probeTenant(withPeople([person(" nybro ")], ["Nybro"]));
    expect(report.grouping!.fields[0].matchesStation).toBe(1);
  });

  it("läser namnet även när fältet är ett objekt", async () => {
    const report = await probeTenant(withPeople([person({ id: "g1", name: "Nybro" })], ["Nybro"]));
    expect(report.grouping!.fields[0].values[0].value).toBe("Nybro");
  });

  it("räknar dem som saknar värde", async () => {
    const report = await probeTenant(withPeople([person(null), person(""), person("Nybro")], ["Nybro"]));
    expect(report.grouping!.fields[0].blank).toBe(2);
  });

  /* Gruppnamn är inte personuppgifter, men kopplingen mellan person och
     grupp är ett steg närmare att vara det — och behövs inte för att
     svara på frågan. */
  it("släpper aldrig ut vem som hör till vilken grupp", async () => {
    const report = await probeTenant(withPeople([person("Nybro")], ["Nybro"]));
    expect(JSON.stringify(report.grouping)).not.toContain("e1");
  });
});

/**
 * En 403 som namnger scopet är en träff, inte ett misslyckande: den
 * bevisar att resursen finns. Rapporten måste bära den vidare så sidan
 * kan säga vad som ska begäras.
 */
describe("nekade vägar", () => {
  it("bär med sig scopet vägen kräver", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("/v1/timeReports")) {
        return new Response(
          JSON.stringify({
            title: "Forbidden",
            detail: "Claim value mismatch: scope=transpaapi:timereports:read.",
            status: 403,
          }),
          { status: 403 },
        );
      }
      return new Response(JSON.stringify({ items: [], cursor: {} }));
    });

    const report = await probeTenant(fetchImpl);
    const denied = report.endpoints.find((e) => e.path === "/v1/timeReports")!;

    expect(denied.outcome).toBe("forbidden");
    expect(denied.status).toBe(403);
    expect(denied.requiredScope).toBe("transpaapi:timereports:read");
  });

  it("skiljer en nekad väg från en som inte finns", async () => {
    const fetchImpl = fakeFetch((url) =>
      url.includes("/v1/absences")
        ? new Response("nix", { status: 404 })
        : new Response(JSON.stringify({ items: [], cursor: {} })),
    );

    const report = await probeTenant(fetchImpl);
    const gone = report.endpoints.find((e) => e.path === "/v1/absences")!;

    expect(gone.outcome).toBe("missing");
    expect(gone.requiredScope).toBeUndefined();
  });
});

/**
 * /v1/shifts/ står i specen och scopet är beviljat, men vägen svarar
 * 404. Fyra gånger har jag byggt en slutsats på ett enda svar och haft
 * fel; den här gången provas varianterna var för sig i stället.
 */
describe("varianter av passvägen", () => {
  const withSpec = (shiftsHandler: (url: string) => Response) =>
    fakeFetch((url) => {
      if (url.includes("openapi")) {
        return new Response(`openapi: 3.0.1
info:
  title: TransPA Public API
  version: 0.1.138
servers:
  - url: https://api.mytranspa.com/publicApi
paths:
  /v1/shifts/:
    get:
      summary: Return a list of Shifts
      parameters:
        - name: from
          in: query
          required: true
        - name: to
          in: query
          required: true
  /v1/employees/{id}/shifts/:
    get:
      summary: Return a list of Shifts for an employee
      parameters:
        - name: startDateTimeAfter
          in: query
          required: true
  /v1/employees:
    get:
      summary: Return a list of Employees
`);
      }
      if (url.includes("/shifts")) return shiftsHandler(url);
      if (url.includes("/v1/employees")) {
        return new Response(JSON.stringify({ items: [{ id: "emp-1" }], cursor: {} }));
      }
      return new Response(JSON.stringify({ items: [], cursor: {} }));
    });

  it("provar varianterna när vägen svarar 404 trots specen", async () => {
    const report = await probeTenant(withSpec(() => new Response("nix", { status: 404 })));

    expect(report.shiftVariants).toBeDefined();
    expect(report.shiftVariants!.length).toBeGreaterThanOrEqual(3);
    expect(report.shiftVariants!.every((v) => v.outcome === "missing")).toBe(true);
    // Varianterna ska skilja sig åt, annars mäter de inget.
    expect(new Set(report.shiftVariants!.map((v) => v.url)).size).toBe(
      report.shiftVariants!.length,
    );
  });

  it("visar fältnamnen när en variant svarar", async () => {
    const report = await probeTenant(
      withSpec((url) =>
        url.endsWith("/v1/shifts/")
          ? new Response(
              JSON.stringify({
                items: [{ id: "s1", employeeId: "e1", startDateTime: "x", endDateTime: "y" }],
                cursor: {},
              }),
            )
          : new Response("nix", { status: 404 }),
      ),
    );

    const hit = report.shiftVariants!.find((v) => v.outcome === "ok")!;
    expect(hit.sampleKeys).toEqual(["employeeId", "endDateTime", "id", "startDateTime"]);
    // Värdena stannar på servern.
    expect(JSON.stringify(report.shiftVariants)).not.toContain("e1");
  });

  it("provar inte varianterna när vägen redan svarar", async () => {
    const report = await probeTenant(
      withSpec(() => new Response(JSON.stringify({ items: [], cursor: {} }))),
    );
    expect(report.shiftVariants).toBeUndefined();
  });

  /* Poängen med hela variantmätningen: specen säger vad som krävs, så
     en variant ska skicka just det i stället för att jag gissar en
     gång till. */
  it("provar med specens obligatoriska parametrar", async () => {
    const sedda: string[] = [];
    const report = await probeTenant(
      withSpec((url) => {
        sedda.push(url);
        return new Response("nix", { status: 404 });
      }),
    );

    const medParametrar = report.shiftVariants!.find((v) => v.what.includes("specens parametrar"));
    expect(medParametrar).toBeDefined();
    expect(medParametrar!.what).toContain("from, to");
    expect(sedda.some((u) => u.includes("from=") && u.includes("to="))).toBe(true);
  });

  /* Vägen via personen är den Visma pekar ut, och den kräver samma
     parameter som listan. Att kravet bara skickades till listan var
     hela skälet till att den här svarade 404. */
  it("skickar kravet även till vägen under personen", async () => {
    const sedda: string[] = [];
    const report = await probeTenant(
      withSpec((url) => {
        sedda.push(url);
        return new Response("nix", { status: 404 });
      }),
    );

    const underPersonen = report.shiftVariants!.filter((v) => v.what.startsWith("under personen"));
    expect(underPersonen).toHaveLength(2);
    expect(underPersonen.some((v) => v.what.includes("specens parametrar"))).toBe(true);
    expect(
      sedda.some((u) => u.includes("/shifts/?") && u.includes("startDateTimeAfter")),
    ).toBe(true);
  });

  /* Specens serveradresser slutar på snedstreck. Utan trimning blev
     anropen publicApi//v1/shifts/. */
  it("bygger inga dubbla snedstreck mot specens bas", async () => {
    const sedda: string[] = [];
    await probeTenant(
      withSpec((url) => {
        sedda.push(url);
        return new Response("nix", { status: 404 });
      }),
    );
    expect(sedda.filter((u) => u.includes("//v1/"))).toEqual([]);
  });
});

/**
 * Skrivvägarna hela vägen ut i rapporten.
 *
 * Läsningen plockade bara ut GET, så en POST i specen kunde finnas utan
 * att synas någonstans i verktyget. Slutsatsen "TransPA har ingen
 * skrivväg" — som fas 3 och 4 vilar på — byggde på det. Nu ska den gå
 * att läsa av i stället för att antas.
 */
describe("skrivvägar ur specen", () => {
  const SPEC = `
openapi: 3.0.1
info:
  title: TransPA Public API
  version: 0.1.138
servers:
  - url: https://api.mytranspa.com/publicApi
paths:
  /v1/shifts/:
    get:
      summary: Get shifts
      parameters: []
    post:
      summary: Create a shift
      parameters: []
  /v1/employees:
    get:
      summary: Get employees
      parameters: []
  /v1/vehicles/{id}:
    put:
      summary: Update a vehicle
      parameters: []
`.trim();

  const medSpec = (spec: string) =>
    fakeFetch((url) => {
      if (url.includes("doc/openapi")) {
        return new Response(spec, {
          headers: { "content-type": "application/yaml", "x-handled": "1" },
        });
      }
      return new Response(JSON.stringify({ items: [], cursor: {} }));
    });

  it("redovisar skrivvägarna, inte bara läsvägarna", async () => {
    const report = await probeTenant(medSpec(SPEC));
    const writes = report.spec?.writes ?? [];

    expect(writes.map((w) => `${w.method} ${w.path}`).sort()).toEqual([
      "POST /v1/shifts/",
      "PUT /v1/vehicles/{id}",
    ]);
  });

  it("bär med sammanfattningen så vägen går att förstå", async () => {
    const report = await probeTenant(medSpec(SPEC));
    expect(report.spec?.writes?.find((w) => w.method === "POST")?.summary).toBe("Create a shift");
  });

  /* Det som faktiskt ska besvaras: går fas 3 och 4 att bygga? Är svaret
     nej ska det vara ett nej och inte en tom lista av bara slarv. */
  it("ger tom lista när specen bara har läsvägar", async () => {
    const baraLasning = `
openapi: 3.0.1
info:
  title: TransPA Public API
  version: 0.1.138
servers:
  - url: https://api.mytranspa.com/publicApi
paths:
  /v1/shifts/:
    get:
      summary: Get shifts
      parameters: []
  /v1/employees:
    get:
      summary: Get employees
      parameters: []
`.trim();

    const report = await probeTenant(medSpec(baraLasning));
    expect(report.spec?.outcome).toBe("ok");
    expect(report.spec?.writes).toEqual([]);
  });
});

/**
 * Urvalet.
 *
 * Det som provas är inte att listan i checks.ts ser rimlig ut — den kan
 * vara perfekt medan probeTenant struntar i den — utan att anropen
 * faktiskt uteblir. Kvoten tog slut en gång; nästa gång ska det inte
 * vara sidan som gjorde det.
 */
describe("urvalet av kontroller", () => {
  /** Räknar anrop mot API:t, inte mot token- eller dokumentvärden. */
  function räknare() {
    const urls: string[] = [];
    const impl = fakeFetch((url) => {
      if (url.includes("api.mytranspa.com/publicApi")) urls.push(url);
      if (url.includes("/v1/employees") && !url.includes("shifts")) {
        return new Response(JSON.stringify({ items: [{ id: "e1" }], cursor: { nextToken: null } }));
      }
      return new Response(JSON.stringify({ items: [], cursor: { nextToken: null } }));
    });
    return { impl, urls };
  }

  it("gör ett enda anrop för anslutningskontrollen", async () => {
    const { impl, urls } = räknare();
    await probeTenant(impl, checkById("anslutning")!.selection);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/v1/alive");
  });

  it("rör bara passvägarna när passkontrollen körs", async () => {
    const { impl, urls } = räknare();
    await probeTenant(impl, checkById("pass")!.selection);

    /* Ett för personen som ger id:t, sedan de två passvägarna. */
    expect(urls).toHaveLength(3);
    expect(urls.filter((u) => u.includes("shifts"))).toHaveLength(2);
    expect(urls.some((u) => u.includes("/v1/vehicles"))).toBe(false);
    expect(urls.some((u) => u.includes("/v1/trips"))).toBe(false);
  });

  it("sätter in ett riktigt person-id i underresursen", async () => {
    const { impl, urls } = räknare();
    await probeTenant(impl, checkById("pass")!.selection);
    expect(urls.some((u) => u.includes("/v1/employees/e1/shifts/"))).toBe(true);
  });

  /* Spec-kontrollen ska inte kosta ett enda API-anrop. */
  it("rör inte API:t när bara specen läses", async () => {
    const { impl, urls } = räknare();
    await probeTenant(impl, checkById("spec")!.selection);
    expect(urls).toHaveLength(0);
  });

  it("sveper fortfarande när svepningen väljs", async () => {
    const { impl, urls } = räknare();
    await probeTenant(impl, checkById("allt")!.selection);
    expect(urls.length).toBeGreaterThan(10);
  });

  /* Utan urval ska allt köras — annars skulle synken och testerna få
     en tystare probe än de bett om. */
  it("kör allt när inget urval anges", async () => {
    const { impl, urls } = räknare();
    await probeTenant(impl);
    expect(urls.length).toBeGreaterThan(10);
  });

  it("visar bara de valda vägarna i rapporten", async () => {
    const { impl } = räknare();
    const report = await probeTenant(impl, checkById("anslutning")!.selection);
    expect(report.endpoints.map((e) => e.path)).toEqual(["/v1/alive"]);
  });

  it("håller varje liten kontroll under fem anrop", async () => {
    for (const check of CHECKS.filter((c) => c.id !== "allt")) {
      clearTokenCache();
      const { impl, urls } = räknare();
      await probeTenant(impl, check.selection);
      expect(urls.length, check.id).toBeLessThanOrEqual(5);
    }
  });
});

/**
 * Passvägarna ur specen.
 *
 * PUT /v1/shifts/{id} svarade 404 direkt efter att GET mot samma adress
 * lyckats, med kroppen {"statusCode":404,"message":"Resource not
 * found"} — en handlare som kört, inte en väg som saknas. Samma sak
 * gällde listvägen tills datumparametrarna skickades med. Specen kostar
 * inga anrop och säger vad vägen vill ha; att prova sig fram kostar ur
 * en kvot som redan tagit slut en gång.
 */
describe("passvägarna i specen", () => {
  const yaml = `
openapi: 3.0.1
info:
  title: TransPA Public API
  version: 0.1.138
servers:
  - url: https://api.mytranspa.com/publicApi
paths:
  /v1/shifts/:
    get:
      summary: List shifts
      parameters:
        - name: startDateTimeAfter
          in: query
          required: true
        - name: startDateTimeBefore
          in: query
          required: true
    put:
      summary: Update a shift
      parameters:
        - name: shiftId
          in: query
          required: true
  /v1/shifts/{id}:
    get:
      summary: Get a shift
      parameters:
        - name: id
          in: path
          required: true
  /v1/employees:
    get:
      summary: List employees
`;

  const medSpec = () =>
    fakeFetch((url) => {
      if (url.includes("swaggerui")) {
        return new Response('<script>url: "/doc/openapi/openapi.yaml"</script>', {
          headers: { "content-type": "text/html", "x-handled": "1" },
        });
      }
      if (url.includes(".yaml")) {
        return new Response(yaml, { headers: { "x-handled": "1" } });
      }
      return new Response(JSON.stringify({ items: [], cursor: { nextToken: null } }));
    });

  it("redovisar varje passväg per metod", async () => {
    const report = await probeTenant(medSpec(), checkById("skrivpass")!.selection);
    const ops = report.spec?.shiftOperations ?? [];
    expect(ops.map((o) => `${o.method} ${o.path}`)).toEqual([
      "GET /v1/shifts/",
      "PUT /v1/shifts/",
      "GET /v1/shifts/{id}",
    ]);
  });

  it("tar med parametrarna och vilka som krävs", async () => {
    const report = await probeTenant(medSpec(), checkById("skrivpass")!.selection);
    const put = report.spec?.shiftOperations?.find((o) => o.method === "PUT");
    expect(put?.parameters.map((x) => x.name)).toEqual(["shiftId"]);
    expect(put?.parameters[0].required).toBe(true);
  });

  it("tar inte med vägar som inte rör pass", async () => {
    const report = await probeTenant(medSpec(), checkById("skrivpass")!.selection);
    expect(report.spec?.shiftOperations?.some((o) => o.path.includes("employees"))).toBe(false);
  });

  /* Kontrollen finns just för att den inte kostar något. */
  it("gör inga API-anrop", async () => {
    const urls: string[] = [];
    const impl = fakeFetch((url) => {
      if (url.includes("api.mytranspa.com/publicApi")) urls.push(url);
      if (url.includes("swaggerui")) {
        return new Response('<script>url: "/doc/openapi/openapi.yaml"</script>', {
          headers: { "content-type": "text/html", "x-handled": "1" },
        });
      }
      if (url.includes(".yaml")) return new Response(yaml, { headers: { "x-handled": "1" } });
      return new Response(JSON.stringify({ items: [], cursor: { nextToken: null } }));
    });
    await probeTenant(impl, checkById("skrivpass")!.selection);
    expect(urls).toEqual([]);
  });
});
