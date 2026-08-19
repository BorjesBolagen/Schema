# Schemaverktyg för chaufförer — plan

## Context

Börjes använder TransPA (Visma) för schemaläggning och tidrapportering och ska
fortsätta med det. Problemet är att TransPA varken är smidigt att justera scheman
i eller dela med förarna, så samma schema underhålls i dag både i TransPA och i
Excel.

Målet: **TransPA är sanningen om hur varje person jobbar.** Verktyget hämtar det,
lägger ut det per vecka, kopplar personerna mot lastbilar, och låter
trafikansvariga justera med musen.

### Vad som ändrats sedan förra planen

Den första omgången utgick från att Excel-filerna skulle importeras och bli
verktygets datakälla. Det är inte vad ni vill. Excel var förlaga för *layouten*,
inget annat — **ingen data från Excel ska sparas.** Personal, fordon och
arbetsdagar kommer från TransPA.

Det som byggts och ska behållas: veckovyn med de två vylägena, veckoberäkningen,
konfliktdetekteringen, namnvisningen och tavelmodellen. Det som ska bort:
hela Excel-importen (`scripts/import/`, `scripts/verify-import.ts`,
`src/lib/alias.ts`) och de tabeller som bara fanns för den
(`employee_alias`, `unresolved_alias`).

### En rättelse om TransPA:s API

Min tidigare slutsats — "TransPA har inga schema- eller frånvaro-endpoints" —
byggde på Vismas **genererade C#-klient** (`Visma-TransPa/TransPA-Public-API-Client`,
API-version 0.1.21). Den klienten är föråldrad: deras egna Postman-exempel
anropar `/v1/trips` med `employeeId`, `startDateTime`, `endDateTime` och
`status`, och den endpointen saknas helt i klienten.

Alltså går det **inte** att utesluta att schema- eller frånvaro-endpoints finns
i dag. Den levande specen ligger på `api.mytranspa.com`, som blockeras av den
här miljöns nätverkspolicy.

Vad jag med säkerhet vet om API:t:

| | |
|---|---|
| Bas-URL | `https://api.mytranspa.com/publicApi` |
| Auth | OAuth2 `client_credentials` mot `https://connect.visma.com/connect/token`, `scope=transpaapi:api …&tenant_id=…`, machine-to-machine, en token per tenant |
| Konventioner | Cursor-paginering (`?cursor={nextToken}`), filter-DSL med `$eq $ne $gt $gte $lt $lte $in $nin` och `$and: $or:` |
| Bekräftade endpoints | `/v1/alive`, `/v1/connectUsers`, `/v1/employees` (+`/{id}`, märkt `[Not ready]`), `/v1/stationPlaces`, `/v1/trafficAreas`, `/v1/vehicleGroups`, `/v1/vehicles` (full CRUD), `/v1/workTasks`, `/v1/trips`, `/v1/salaries/{id}` med webhook |
| Okänt | Om planerade pass, skift eller frånvaro finns. Om `Employee` bär `stationPlaceId` — det behövs för er stationsortsfiltrering, och den kända (föråldrade) modellen har bara Id, FirstName, LastName, EmployeeNumber, Signature, IsActive |

### Beslutade ramar

| | |
|---|---|
| Plattform | Webbapp: Next.js + TypeScript + Postgres (Drizzle), redan uppsatt |
| API-spec | `api.mytranspa.com` allowlistas i miljöns nätverkspolicy så spec:en kan läsas |
| Ett pass | Dag + **dag/natt-skift** |
| Om TransPA inte kan ge arbetsdagar | Lokala arbetsmönster i appen fyller luckan |
| Excel | Endast förlaga. Ingen data sparas. Importkoden tas bort |

---

## Design

### Begreppen

**Tavla** — en vy som en trafikansvarig äger och själv bygger. Rader, namn,
gruppering, ordning, veckodagar och vilka fält en cell visar styrs härifrån.

**Bemanning** (`board_crew`) — vilka personer den här tavlan hanterar. Väljs ur
hela TransPA-listan, filtrerad på stationsort, med *Välj alla i Nybro*.

**Bas-schema** (`base_schedule`) — den stående kopplingen person ↔ lastbil, med
skift och giltighetsperiod. Flera personer får kopplas till samma bil; **vem som
faktiskt står där en viss dag avgörs av personens arbetsdagar.** Det är precis
hur era fjärrblad ser ut: BT13/14 körs av Björn måndag, tisdag, torsdag, fredag
och av Roger onsdag — inte för att någon skrivit in det per dag, utan för att de
jobbar de dagarna.

**Arbetsdagar** — vilka dagar en person jobbar och på vilket skift. Hämtas från
TransPA; tills det går läses de ur ett lokalt arbetsmönster.

**Pass** (`assignment`) — den konkreta cellen: datum × rad × person × skift.
Skapas av *Fyll veckan* eller för hand, och flyttas med musen.

### Veckovyn

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Fjärr Nybro/Hultsfred ▾   ◀ Vecka 34 · 17–21 aug 2026 ▶   ⚙ Tavla   👥 Bemanning       │
│  Vy: [Bilar ▾]                              [Fyll veckan]  [Bas-schema]  [Dela ▾]       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ⚠ 1 dubbelbokning · 2 personer jobbar men saknar bil            ┌───────────────────┐  │
├──────────┬──────────┬─────────┬─────────┬─────────┬─────────────┤ BEMANNING         │  │
│ Bil      │ Linje    │ Mån 17  │ Tis 18  │ Ons 19  │ Tor 20      │ Nybro ▾  [+ lägg]  │  │
├──────────┴──────────┴─────────┴─────────┴─────────┴─────────────┤                   │  │
│ ▸ STOCKHOLM                                                     │ ⋮⋮ Elin Karlsson  │  │
├──────────┬──────────┬─────────┬─────────┬─────────┬─────────────┤    jobbar mån–tor │  │
│ BT08/09  │Stockholm │☀ Elin K │☀ Elin K │☀ Elin K │☀ Elin K     │ ⋮⋮ Roger B        │  │
│          │          │🌙 Peter │🌙 Peter │🌙 Peter │🌙 ▢          │    jobbar ons     │  │
├──────────┼──────────┼─────────┼─────────┼─────────┼─────────────┤ ⋮⋮ Björn W        │  │
│ BT13/14  │Västerås  │☀ Björn W│☀ Björn W│☀ Roger B│☀ Björn W    │    🏖 v.34        │  │
│          │          │         │         │         │             │                   │  │
├──────────┼──────────┼─────────┼─────────┼─────────┼─────────────┤ EJ UTLAGDA        │  │
│ BT24/26  │Västerås  │☀ ▢ tom  │☀ Johan O│☀ Johan O│☀ Johan O ⚠  │ ⋮⋮ Max K  mån–fre │  │
└──────────┴──────────┴─────────┴─────────┴─────────┴─────────────┴───────────────────┘
```

Sidopanelen är dragkällan. Den visar tavlans bemanning med **vilka dagar var och
en jobbar den veckan** enligt TransPA, och längst ned *Ej utlagda* — personer som
jobbar men ännu inte står på någon bil. Den listan ska bli tom när veckan är klar,
och är därför också veckans kvitto.

**Dra och släpp**, med `@dnd-kit` som redan ligger i projektet:

- Dra en person från sidopanelen till en cell → passet läggs ut.
- Dra ett befintligt pass till en annan cell → det flyttas, oavsett om det är
  till en annan bil, en annan dag eller båda.
- Dra ett pass tillbaka till sidopanelen → det tas bort.
- Håll ⇧ medan du drar → passet kopieras i stället för att flyttas.

Släppzoner som skulle skapa en krock markeras rött redan under dragningen, med
orsaken i en liten etikett — planeraren ska se problemet innan hen släpper, inte
efter.

**Cellen** har en rad per skift, ☀ för dag och 🌙 för natt, enligt tavlans
inställning. En bil som bara körs dagtid visar bara solraden.

### Fyll veckan

Knappen är hela poängen med bas-schemat.

1. Hämta arbetsdagarna för tavlans bemanning under veckan.
2. För varje arbetsdag: hitta personens bas-schemarad som gäller det datumet och
   det skiftet, och lägg ut passet där.
3. Rör aldrig ett pass som någon ändrat för hand.
4. Rapportera: vilka som jobbar men saknar bas-schemarad, och vilka rader som
   blev tomma.

Körningen är idempotent — bara automatgenererade pass skrivs om, så knappen går
att trycka på igen när TransPA-schemat ändrats utan att handpåläggningen försvinner.

### Bemanningsväljaren

```
┌──────────────────────────────────────────────────────────────┐
│  Lägg till personal                                    [Klar]│
│  Stationsort [Nybro ▾]   Sök […………]      [Välj alla i Nybro] │
├──────────────────────────────────────────────────────────────┤
│  ☑ Andreas Jakobsson    Nybro      anst.nr 2262              │
│  ☑ Magnus Holm          Nybro      anst.nr 2053              │
│  ☐ Jörgen Norman        Nybro      anst.nr 2076              │
│  ☐ Anders Håkansson     Gävle      anst.nr 2430              │
└──────────────────────────────────────────────────────────────┘
```

Listan är hela personalregistret från TransPA. Om `Employee` visar sig sakna
stationsort sätts den en gång per person i appen i stället — filtreringen ska
finnas oavsett, eftersom det är den som gör listan hanterbar.

### Bas-schemat

```
┌──────────────────────────────────────────────────────────────────────┐
│  Bas-schema · Fjärr Nybro/Hultsfred                            [Klar]│
├───────────────┬──────────────┬────────┬───────────────┬──────────────┤
│ Rad           │ Person       │ Skift  │ Gäller från   │ Gäller till  │
├───────────────┼──────────────┼────────┼───────────────┼──────────────┤
│ BT08/09       │ Elin K       │ ☀ Dag  │ 2026-01-01    │ —            │
│ BT08/09       │ Peter M      │ 🌙 Natt │ 2026-01-01    │ —            │
│ BT13/14       │ Björn W      │ ☀ Dag  │ 2026-01-01    │ —            │
│ BT13/14       │ Roger B      │ ☀ Dag  │ 2026-01-01    │ —            │
└───────────────┴──────────────┴────────┴───────────────┴──────────────┘
```

Björn och Roger står båda på BT13/14 utan att någon anger vilka dagar — det
avgör deras arbetsdagar. Giltighetsperioden gör att en omläggning kan skrivas in
i förväg utan att historiken skrivs om.

### Arbetsmönster (tills TransPA levererar)

Ett mönster per person: en cykel på 1–8 veckor, med veckodagar och skift per
cykelvecka, plus ett ankardatum som avgör var i cykeln en given vecka hamnar.

En vanlig anställd får cykellängd 1 och kryssar i måndag–fredag. Värnamos
rullande upplägg — pass 1–4 som roterar per vecka — är cykellängd 4. Samma
tabell klarar båda.

Hämtningen ligger bakom ett gränssnitt:

```ts
export interface WorkDay {
  employeeId: string;
  date: string;
  shift: "day" | "night";
}

export interface WorkDayProvider {
  readonly name: string;
  getWorkDays(employeeIds: string[], from: string, to: string): Promise<WorkDay[]>;
}
```

`LocalPatternProvider` läser mönstertabellen. `TranspaWorkDayProvider` läser
TransPA när vi vet vilken endpoint som gäller. `CompositeWorkDayProvider` frågar
TransPA först och faller tillbaka på mönstret **per person** — så övergången
sker person för person i stället för som ett omkast, och en person vars TransPA-
schema saknas fortsätter fungera.

---

## Teknisk plan

### Datamodell (`src/db/schema.ts`)

**Tas bort:** `employee_alias`, `unresolved_alias` — smeknamnsuppslag behövdes
bara för Excel-importen.

**Ändras:**

| Tabell | Ändring |
|---|---|
| `employee` | Excel-fälten (`trafficAreaText`, `stationPlaceText`, `vacationGroup`, `workGroup`, `supervisor`) utgår. `stationPlaceId` blir det som stationsortsfiltret använder, satt av synken eller för hand |
| `assignment` | Ny `shift` (`day`/`night`) och `source` (`generated`/`manual`). Unik nyckel blir `(boardRowId, date, shift, slot)` |

**Nya:**

| Tabell | Innehåll |
|---|---|
| `board_crew` | `boardId`, `employeeId`, `sortOrder` — vilka tavlan hanterar |
| `base_schedule` | `boardId`, `boardRowId`, `employeeId`, `shift`, `validFrom`, `validTo`, `sortOrder` |
| `work_pattern` | `employeeId`, `cycleWeeks` (1–8), `anchorDate`, `validFrom`, `validTo` |
| `work_pattern_day` | `workPatternId`, `cycleWeek`, `weekday` (0–6), `shift` |

### Kod

**Behålls oförändrat:** `src/lib/week.ts`, `src/lib/name.ts`, `src/db/index.ts`,
`src/db/migrate.ts` — alla med sina tester.

**Behålls, byggs ut:**

- `src/lib/conflicts.ts` — skiftet in i reglerna. Samma bil dag och natt är
  ingen krock; samma person två gånger samma skift är det. Samma person på både
  dag- och nattpass samma dygn flaggas separat, mildare.
- `src/server/board-week.ts` — bemanning, bas-schema och arbetsdagar in i det
  vyn får; `availableByDate` byts mot *vem jobbar och var står de*.
- `src/components/WeekGrid.tsx` — skiftrader i cellen, dra och släpp.
- `src/components/PersonGrid.tsx` — skift i personvyn.
- `src/app/actions.ts` — `moveAssignment`, `copyAssignment`, `fillWeek`,
  `setCrew`, `setBaseSchedule`.

**Nytt:**

| Fil | Ansvar |
|---|---|
| `src/lib/work-days.ts` | `WorkDayProvider`, `LocalPatternProvider`, `CompositeWorkDayProvider`, cykelberäkningen |
| `src/server/fill-week.ts` | *Fyll veckan* — ren funktion över arbetsdagar + bas-schema, plus databasskrivningen |
| `src/components/CrewPanel.tsx` | Sidopanelen, dragkälla |
| `src/components/CrewPicker.tsx` | Personalväljaren med stationsortsfilter |
| `src/components/BaseSchedule.tsx` | Bas-schemat |
| `src/components/BoardEditor.tsx` | Tavelredigering: rader, namn, ordning, grupper, veckodagar, skift, delning |
| `src/lib/transpa/*` | Auth, klient med cursor och filter-DSL, synk, `TranspaWorkDayProvider` |

**Tas bort:** `scripts/import/` (9 filer), `scripts/verify-import.ts`,
`src/lib/alias.ts` + test. `scripts/screenshot.ts` behålls — den blir grunden
för PDF-exporten.

### Faser

**Fas 0 — parallellt, blockerar inget**
Allowlista `api.mytranspa.com` i miljöns nätverkspolicy så specen kan läsas.
Registrera organisationen på Visma Developer Portal och begär access med
scopes `transpaapi:api`, `:employees:read`, `:vehicles:read`,
`:vehiclegroups:read`, `:trafficareas:read`, `:stationplaces:read`,
`:trips:read`. Sandbox ges manuellt av Visma och tar kalendertid.

**Fas 1 — rensa ut Excel**
Ta bort importen och de tabeller som hörde till. Ny migration. Databasen
töms — inget av det som ligger där nu ska överleva.

**Fas 2 — arbetsmönster och arbetsdagar**
Mönstertabellerna, cykelberäkningen, `LocalPatternProvider`, enkel
mönsterredigering per person. Klart när en person med cykellängd 4 ger rätt
dagar för godtycklig vecka.

**Fas 3 — bemanning och bas-schema**
`board_crew`, personalväljaren med stationsortsfilter och *välj alla*,
bas-schemavyn.

**Fas 4 — fyll veckan**
Genereringen, rapporten över ej utlagda, idempotensen.

**Fas 5 — dra och släpp**
Dra ut från sidopanelen, flytta pass mellan celler och dagar, kopiera med ⇧,
ta bort genom att dra tillbaka, samt att otillåtna släppzoner markeras under
dragningen.

**Fas 6 — tavelredigering**
Rader, namn, ordning, grupprubriker, färg, veckodagar, skiftvisning, delning
med kollegor. Det är den fas som gör att varje trafikansvarig kan ta över sin
egen tavla.

**Fas 7 — TransPA-synk** *(kräver Fas 0)*
Auth, klient, synk av personal, fordon, stationsorter, trafikområden.
`TranspaWorkDayProvider` mot den endpoint spec:en visar sig ha — och om ingen
finns, mot `/v1/trips` som underlag för att föreslå mönster.

**Fas 8 — frånvaro, semester och export**
Semesterårsvyn, frånvaro in i konflikterna, PDF och Excel-export ur tavlans
egen layout.

---

## Verifiering

- **Cykelberäkningen:** enhetstest att cykellängd 4 med givet ankardatum ger
  samma pass-per-vecka-mappning som `Lists`-fliken i Värnamo-filen (vecka 9 →
  pass 3, vecka 31 → pass 1), och att cykellängd 1 ger vanliga veckodagar.
- **Fyll veckan:** kör två gånger i rad och kontrollera att resultatet är
  identiskt; ändra ett pass för hand, kör igen, och kontrollera att ändringen
  står kvar medan de genererade uppdateras.
- **Bas-schemat mot verkligheten:** bygg upp BT13/14 med Björn och Roger,
  ge Björn mån/tis/tors/fre och Roger ons, fyll veckan, och kontrollera att
  bilen bemannas alla fem dagarna av rätt person.
- **Konflikter:** dag- och nattpass på samma bil ger ingen varning; två personer
  samma bil samma skift ger varning; samma person på två bilar samma skift ger
  varning även när bilarna ligger på olika tavlor.
- **Dra och släpp (Playwright):** dra en person ur sidopanelen till en cell,
  flytta passet till en annan dag, kontrollera att *Ej utlagda* krymper och att
  en otillåten släppzon markeras.
- **Layoutfrihet:** bygg om en tavla till lotsupplägget — rader = ort, inga
  bilnummer — enbart i tavelredigeraren, utan kodändring.
- **API:** `GET /v1/alive` mot sandbox, därefter `/v1/employees` och
  `/v1/vehicles` med cursor över mer än en sida.

## Öppna punkter

1. **Vad TransPA faktiskt kan leverera.** Avgör om Fas 7 blir en hämtning av
   planerade pass eller ett mönsterförslag ur `/v1/trips`. Allowlistningen i
   Fas 0 är vägen dit.
2. **Om `Employee` bär stationsort.** Gör den inte det behöver någon sätta den
   en gång per person i appen.
3. **Om `/v1/trips` är planerade eller körda turer.** Planerade skulle göra
   arbetsmönstren till en kort parentes; körda gör dem till grunden ett tag.
4. Semestergrupperna kom från Excel och försvinner med importen. Till Fas 8
   behöver vi veta om de ska grupperas på stationsort eller läggas in på nytt.
5. Var appen ska köras och vem som administrerar den.
