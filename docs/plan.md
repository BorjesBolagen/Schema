# Schemaverktyg för chaufförer — design och utvecklingsplan

## Context

Börjes använder TransPA (Visma) för schemaläggning och tidrapportering för alla chaufförer, och ska fortsätta med det. Problemet är att TransPA varken är smidigt att justera scheman i eller exportera från på ett sätt som går att dela med förarna. Därför görs idag dubbelarbete: samma schema underhålls både i TransPA och i Excel.

Målbilden är: hämta varje persons schema från TransPA, lägga ut det per vecka, visualisera vilket lastbilsnummer de kör respektive dag, planera semester och frånvaro, och läsa tillbaka frånvaron på personen i TransPA.

### Vad Excel-filerna faktiskt visar

De bifogade filerna innehåller **fem olika layouter av samma grundinformation** — vem kör vad, vilken dag, med vilken bil:

| Blad | Rader | Kolumner | Cellinnehåll |
|---|---|---|---|
| `Schema NYBHLF` (vänsterblock) | bil/linje (`BT08/09`, `HF13`, `Dahl 4010`) | mån–fre | förarens smeknamn |
| `Schema NYBHLF` (högerblock) | bil/linje | **sön**–fre | förarens smeknamn |
| `Gävle lotsschema` | linje/ort (`GBG 1 Stycke`) | mån–fre | förare **+ klockslag** (`Therese 06.00-17`) |
| `Hudiksvall schema` | **datum** | **person** (`Ulrik`, `Anders F`) | ort |
| `TRAFIKLEDNING` | **person** | mån–fre | ort/status |
| `Vmoschema` `GrundSchema` | linje × *Hemma*/*Kör* | 4 pass × sön–fre | namn, rullande 4-veckorscykel |

Övrigt värt att notera: `Personallista` är masterdata med 268 rader (anställningsnr, signatur, trafikområde, stationsort, semestergrupp, arbetsgrupp, aktiv). Semester och frånvaro skrivs som fritextrader längst ned i varje veckoblock (`Alex S hela veckan`, `Albin L tis`). Status kodas med cellfärger utan legend. Fliken `Lists` i Vmoschema mappar veckonummer → passnummer i 4-veckorscykeln.

Att layouterna skiljer sig är inte slarv — de speglar hur olika trafikansvariga faktiskt vill se sin verksamhet. **Systemet ska därför inte kopiera något av bladen, utan låta varje trafikansvarig bygga sin egen vy** av en gemensam datamodell.

### Avgörande begränsning: TransPA:s API

Verifierat mot Vismas egen genererade API-klient (`github.com/Visma-TransPa/TransPA-Public-API-Client`, HEAD 2026-08-07, API-version 0.1.21):

- **Bas-URL:** `https://api.mytranspa.com/publicApi`
- **Auth:** OAuth2 `client_credentials` mot `https://connect.visma.com/connect/token`, body `grant_type=client_credentials&scope=transpaapi:api …&tenant_id=…`. Endast machine-to-machine. **En token per tenant.**
- **Konventioner:** cursor-paginering (`?cursor={nextToken}`), filter-DSL (`?filter=employeeId$in:[a,b]$and:status$eq:approved`) med komparatorerna `$eq $ne $gt $gte $lt $lte $in $nin` och operatorerna `$and: $or:`.
- **Tillgängliga endpoints:** `GET /v1/alive`, `GET /v1/connectUsers`, `GET /v1/employees` + `/{id}` (**märkt `[Not ready]`**), `GET /v1/stationPlaces`, `GET /v1/trafficAreas`, `GET /v1/vehicleGroups`, `GET/POST/PUT/DELETE /v1/vehicles`, `GET /v1/workTasks`, samt `/v1/salaries/{id}` med webhook-prenumeration för löneexport.
- **Finns INTE:** schema/pass, frånvaro, semester, eller skrivbar tidrapportering. Visma skriver att det kommer "eventually".

**Konsekvens:** flödet "hämta schemat ur TransPA → planera → skriv tillbaka semestern" går inte att bygga rakt av idag. Grunddata (personal, fordon, trafikområden, stationsorter) går däremot att synka. Systemet måste därför **själv äga schemat** och ha en utbytbar återläsningsadapter som slås på när Visma släpper endpoints.

### Beslutade ramar

| | |
|---|---|
| Plattform | Egen webbapp (TypeScript/Next.js + Postgres) |
| TransPA-access | Inget påbörjat — ansökan ingår i planen |
| Utdelning till förare | PDF/bild per vecka + Excel-export |
| Omfattning v1 | En enhet som pilot: **Fjärr Nybro/Hultsfred** |

---

## Design

### Grundidé: en konfigurerbar planeringstavla

Kärnan är **tavlan** (*board*) — en vy som en trafikansvarig äger och själv bygger. En tavla består av **rader** som ska bemannas, och kolumner som är dagar. Raden är det som gör layouten fri: den trafikansvarige namnger den själv (`BT08/09`, `Stockholm natt`, `Lots Växjö`), sorterar den, grupperar den under egna rubriker, och kopplar den till en lastbil om den ska ha en.

All information ligger i en gemensam databas — vem, vilken dag, vilken bil, vilken frånvaro. Tavlan är bara ett sätt att titta på och redigera den. Två trafikansvariga kan ha helt olika layout över överlappande personal, och systemet ser ändå att samma förare är dubbelbokad.

### Veckovyn

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  Fjärr Nybro/Hultsfred ▾    ◀  Vecka 32 · 3–9 aug 2026  ▶      ⚙ Redigera tavla        │
│  Vy: [Bilar ▾]  Dagar: [Mån–Fre ▾]                     [Kopiera förra veckan] [Dela ▾] │
├───────────────────────────────────────────────────────────────────────────────────────┤
│  ⚠ 2 obemannade pass · 1 dubbelbokning (Roger B ons)                     ┌───────────┐ │
├────────────┬──────────┬─────────┬─────────┬─────────┬─────────┬─────────┤ TILLGÄNG- │ │
│ Rad        │ Linje    │ Mån 3   │ Tis 4   │ Ons 5   │ Tor 6   │ Fre 7   │ LIGA · ons │ │
├────────────┴──────────┴─────────┴─────────┴─────────┴─────────┴─────────┤           │ │
│ ▸ STOCKHOLM                                                             │ Teodor H  │ │
├────────────┬──────────┬─────────┬─────────┬─────────┬─────────┬─────────┤ Hampus P  │ │
│ BT08/09    │Stockholm │ Elle    │ Elle    │ Elle    │ Elle    │ Elle    │ Oliver K  │ │
│            │          │ BT08    │ BT08    │ BT09    │ BT09    │ BT08    │ Yamen Z   │ │
├────────────┼──────────┼─────────┼─────────┼─────────┼─────────┼─────────┤           │ │
│ BT20/28    │Stockholm │Dahl/Lef │Dahl/Lef │Dahl/Lef │Dahl/Lef │Dahl/Lef │ FRÅNVARO  │ │
├────────────┴──────────┴─────────┴─────────┴─────────┴─────────┴─────────┤ Alex S 🏖  │ │
│ ▸ VÄSTERÅS                                                              │ Björn W 🏖 │ │
├────────────┬──────────┬─────────┬─────────┬─────────┬─────────┬─────────┤ Albin L 🤒 │ │
│ BT13/14    │Västerås  │ Björn W │ Björn W │ Roger B │ Björn W │ Björn W │           │ │
│            │          │ BT13    │ BT13    │  ⚠ BT14 │ BT13    │ BT13    │           │ │
├────────────┼──────────┼─────────┼─────────┼─────────┼─────────┼─────────┤           │ │
│ BT24/26    │Västerås  │ Johan O │ Johan O │ Johan O │ Johan O │  ▢ tom  │           │ │
├────────────┴──────────┴─────────┴─────────┴─────────┴─────────┴─────────┴───────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Sidopanelen** är den största praktiska vinsten mot Excel. Den visar vilka förare som är lediga just den dag man håller på med, vilka som är frånvarande och varför. Dra en person till en cell, eller klicka i cellen och skriv de första bokstäverna. Redan bokade personer visas gråade med var de står.

**Cellen** visar förare på första raden och bilnummer på andra. Bilnumret föreslås från radens standardfordon men går att byta per dag. Vilka fält en cell visar är en tavelinställning: lotsschemana behöver klockslag (`Therese 06.00–17.00`), fjärrschemat behöver det inte, och trafikledningens tavla vill ha ort istället för bil.

**Konfliktmarkering** i realtid, det Excel inte kan: samma person på två rader samma dag (även tvärs över tavlor), person inplanerad under sin frånvaro, obemannad rad, samma bil på två rader.

### Vy-växlingen: bilar ↔ personer

Samma vecka, samma data, två sätt att titta. Rullgardinen `Vy:` växlar mellan att ha **bilar/linjer som rader** och **personer som rader**:

```
│ Person       │ Mån 3        │ Tis 4        │ Ons 5        │ Tor 6        │ Fre 7      │
├──────────────┼──────────────┼──────────────┼──────────────┼──────────────┼────────────┤
│ Elle         │ BT08 Sthlm   │ BT08 Sthlm   │ BT09 Sthlm   │ BT09 Sthlm   │ BT08 Sthlm │
│ Björn W      │ BT13 Vsts    │ BT13 Vsts    │ 🏖 Semester  │ BT13 Vsts    │ BT13 Vsts  │
│ Roger B      │ ▢            │ ▢            │ BT14 Vsts    │ ▢            │ ▢          │
```

Det är exakt vad `TRAFIKLEDNING`- och `Hudiksvall`-bladen gör idag, men utan att någon behöver underhålla en andra kopia av datat. Personvyn är också det man skriver ut när en enskild förare frågar "vad kör jag nästa vecka".

### Redigera tavla

Knappen `⚙ Redigera tavla` växlar in ett redigeringsläge där den trafikansvarige styr allt utseende:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Redigera: Fjärr Nybro/Hultsfred                        [Klar]  [Ångra]   │
├───────────────────────────────────────────────────────────────────────────┤
│  Kolumner    Veckostart [Måndag ▾]   Dagar [☑M ☑T ☑O ☑T ☑F ☐L ☐S]        │
│  I cellen    [☑ Förare] [☑ Bilnummer] [☐ Klockslag] [☑ Notering]          │
│  Delas med   Fredrik Axelsson, Jörgen Linåker            [+ Lägg till]    │
├───────────────────────────────────────────────────────────────────────────┤
│  RADER                                        [+ Rad]  [+ Grupprubrik]    │
│  ⣿ ▸ STOCKHOLM                                                  ✎  🗑      │
│  ⣿   BT08/09    │ Stockholm  │ Bil: BT08 ▾ │ Färg ⬤ │            ✎  🗑     │
│  ⣿   BT20/28    │ Stockholm  │ Bil: BT20 ▾ │ Färg ⬤ │            ✎  🗑     │
│  ⣿ ▸ VÄSTERÅS                                                   ✎  🗑      │
│  ⣿   BT13/14    │ Västerås   │ Bil: BT13 ▾ │ Färg ⬤ │            ✎  🗑     │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Namnge fritt.** Radens visningsnamn är den trafikansvariges eget. Kopplingen till en lastbil är separat, så `BT08/09` kan heta vad som helst utan att bilnumret tappas.
- **Dra för att sortera**, gruppera under egna rubriker, sätt radfärg.
- **Lägg till och ta bort rader** när linjer tillkommer eller ställs in. En rad kan avslutas med ett datum istället för att raderas, så historiken finns kvar (`BT17/23 Inställd v.28–31` blir ett giltighetsintervall istället för en fritextcell).
- **Bilnamn ändras centralt.** Lastbilarna kommer från TransPA, men varje bil får ett visningsnamn som ni styr — TransPA:s `externalId` behöver inte vara det ni kallar bilen i vardagen.
- **Tavlan delas** med de kollegor som ska kunna redigera. Övriga ser den men kan inte ändra.

Grundprincipen: en trafikansvarig ska kunna bygga sin tavla färdig utan att någon utvecklare behöver kopplas in.

### Semesterplaneringsvyn

Årsvy, en rad per person, 52 kolumner. Ersätter dagens spridda "Semester"-rader.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Semesterplanering 2027   Semestergrupp: [Nybro ▾]            [Excel] [PDF]  │
├───────────────────┬──────────────────────────────────────────────────────────┤
│                   │ v.24  25  26  27  28  29  30  31  32  33  34  35  36     │
├───────────────────┼──────────────────────────────────────────────────────────┤
│ Andreas Jakobsson │      ███████████████                                      │
│ Magnus Holm       │                    ███████████                            │
│ Jörgen Norman     │  ▒▒▒ (önskad)      ███████████████                        │
│ Ulf Nilsson       │                                        ███████████        │
├───────────────────┼──────────────────────────────────────────────────────────┤
│ Bemanning kvar    │  12  11   8   5   4   4   5   7   9  11  12  12  12      │
│                   │              ⚠   ⚠   ⚠                                    │
└───────────────────┴──────────────────────────────────────────────────────────┘
```

Dra över veckor för att markera; heldragen = beviljad, rastrerad = önskemål. Bemanningsraden räknar kvarvarande förare per semestergrupp och varnar under en satt miniminivå — det som idag upptäcks först när en vecka visar sig omöjlig att bemanna. Samma vy används för övrig frånvaro (sjuk, VAB, tjänstledig, kompledig, föräldraledig) via typfilter.

### Export

- **PDF/PNG per vecka** — renderas från samma HTML som veckovyn via Chromium print-to-PDF, A4 liggande, i den layout den trafikansvarige har byggt. Både bil-vyn och person-vyn kan skrivas ut.
- **Excel-export** — `.xlsx` som följer tavlans radordning och gruppering.

---

## Teknisk plan

### Stack

Next.js (App Router) + TypeScript, Postgres via Drizzle, Tailwind. PDF genereras med Playwright/Chromium (redan installerat i miljön, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Excel skrivs med `exceljs`. Drag & drop med `dnd-kit`. Inloggning för planerare; ingen inloggning för förare i v1 eftersom utdelningen sker som PDF/Excel.

### Datamodell (`db/schema.ts`)

**Masterdata — delas av alla tavlor**

| Tabell | Innehåll | Källa |
|---|---|---|
| `employee` | `transpaId`, `employeeNumber`, `firstName`, `lastName`, `signature`, `isActive`, `trafficAreaId`, `stationPlaceId`, `vacationGroup`, `workGroup` | TransPA `/v1/employees` när den fungerar, annars CSV från `Personallista` |
| `employee_alias` | smeknamn → `employeeId` (`Elle`, `Mylla`, `Per H`) | importeras ur Excel, redigerbart |
| `vehicle` | `transpaId`, `registrationNumber`, `externalId`, **`displayName`** (lokalt, redigerbart), `trafficAreaId`, `vehicleGroupId`, `isActive` | TransPA `/v1/vehicles` + lokal namngivning |

**Tavlan — ägs av trafikansvarig**

| Tabell | Innehåll |
|---|---|
| `board` | `name`, `trafficAreaId`, `weekStartDay`, `visibleWeekdays[]`, `defaultViewMode` (`resource`/`person`), `cellFields[]` (`driver`,`vehicle`,`time`,`note`), `sortOrder` |
| `board_row` | `boardId`, `label`, `sublabel`, `groupLabel`, `sortOrder`, `color`, `defaultVehicleId`, `validFrom`, `validTo`, `rowKind` (`resource`/`person`), `employeeId` (för person-rader) |
| `board_member` | `boardId`, `userId`, `role` (`editor`/`viewer`) |

**Planeringsdata**

| Tabell | Innehåll |
|---|---|
| `assignment` | `date`, `boardRowId`, `employeeId`, `vehicleId`, `startTime?`, `endTime?`, `note`, `updatedBy`, `updatedAt` |
| `absence` | `employeeId`, `fromDate`, `toDate`, `type`, `status` (`requested`/`approved`), `note`, `transpaSyncedAt`, `transpaSyncedBy` |
| `sync_run` | tidpunkt, resurs, antal, fel |

Tre designval förtjänar motivering. `board_row` ersätter en fast `line`-tabell — det är just den indirektionen som gör layouten redigerbar utan utvecklare, och `validFrom/validTo` gör att inställda linjer kan avslutas utan att historiken försvinner. `employee_alias` är inte överarbete: era planerare skriver smeknamn och kommer fortsätta göra det. `absence.transpaSyncedAt/By` är kvitteringen som visar vad som faktiskt är inlagt i TransPA så länge återläsningen är manuell.

Konfliktdetektering frågar på `employeeId`/`vehicleId` per datum **globalt**, inte per tavla — därför fångas en förare som dubbelbokats på både fjärr- och lotstavlan.

### TransPA-klient (`lib/transpa/`)

- `auth.ts` — client_credentials-token med cache och förnyelse per `(tenantId, scopes)`.
- `client.ts` — fetch-wrapper med cursor-paginering (följer `nextToken` och behåller övriga query-parametrar, vilket Vismas dokumentation uttryckligen kräver), filter-DSL-byggare, retry med backoff, felhantering på `application/problem+json`.
- `sync.ts` — hämtar `vehicles`, `vehicleGroups`, `trafficAreas`, `stationPlaces`, `employees` till lokala tabeller. Upsert på `transpaId`; rör aldrig lokala `displayName`. Nattligt jobb + manuell knapp.
- `absence-export.ts` — interface `AbsenceExportAdapter` med två implementationer:
  - `ManualListAdapter` (v1) — genererar arbetslista/CSV per person och period som en admin knappar in i TransPA, och stämplar `transpaSyncedAt` vid kvittering.
  - `TranspaApiAdapter` — stub som kastar `NotImplementedError`, aktiveras via feature flag när Visma släpper frånvaro-endpoints. Ingen annan kod ska behöva ändras då.

Scopes att begära: `transpaapi:api` (obligatorisk), `transpaapi:employees:read`, `transpaapi:vehicles:read`, `transpaapi:vehiclegroups:read`, `transpaapi:trafficareas:read`, `transpaapi:stationplaces:read`.

### Import av befintlig data (`scripts/import/`)

- `personallista.ts` — 268 rader → `employee`. Nyckel: `anställningsnr`. `signatur` blir första alias.
- `schema-nybhlf.ts` — parsar veckoblocken (block börjar på rad med `Vecka N`, sedan datumrad, sedan radrader tills tom rad) → `board`, `board_row`, `assignment`, samt alias-kandidater ur cellinnehållet. `Inställd V.28-31` blir `validTo` på raden; `###` blir obemannad; `Alex S hela veckan` under `Semester` blir `absence`.
- Namn som inte kan mappas hamnar i en rapport för manuell koppling istället för att tyst kastas.

### Faser

**Fas 0 — parallellt från dag 1, blockerar inget annat**
Registrera organisationen på Visma Developer Portal, ansök om access till TransPA Public API med scopes ovan, begär sandbox-tenant. Sandbox-access ges manuellt av Visma idag, så det tar kalendertid. Ställ samtidigt två frågor till Visma: *när* kommer shift/absence-endpoints, och *finns* filimport för frånvaro i TransPA under tiden. Svaren avgör hur länge `ManualListAdapter` behöver leva.

**Fas 1 — datamodell och import**
Repo-scaffold, schema, migrationer, importskripten. Klart när `Personallista` och `Schema NYBHLF` v.27–32 ligger i databasen med korrekt förar-till-alias-mappning.

**Fas 2 — veckovyn**
Rutnätet, sidopanel med tillgängliga förare, drag & drop, celltilldelning med typ-för-att-söka, bilnummerval, konfliktmarkering, kopiera-vecka. Vy-växling bilar ↔ personer.

**Fas 3 — tavelredigering**
Redigeringsläget: rader, grupprubriker, sortering, färg, standardfordon, giltighetsintervall, kolumninställningar, cellfältsval, delning med kollegor. Det är den här fasen som gör att varje trafikansvarig kan ta över sin egen tavla — den bör demas för dem innan Fas 4.

**Fas 4 — frånvaro och semesterplanering**
Frånvarotabell, årsvyn med dragmarkering, bemanningsberäkning per semestergrupp, koppling till sidopanelen och konfliktmarkeringen.

**Fas 5 — export**
PDF/PNG via Chromium print, `.xlsx` via exceljs, båda i tavlans egen layout.

**Fas 6 — TransPA-synk** *(kräver Fas 0 klar)*
Auth, klient, synk av fordon och grunddata. `employees` bakom en flagga eftersom endpointen är märkt `[Not ready]` — CSV-importen förblir primär väg tills den visar sig fungera i er tenant.

**Fas 7 — återläsning**
`ManualListAdapter` med kvittering. `TranspaApiAdapter` kopplas in när endpoints finns.

---

## Verifiering

- **Importtrohet:** kör importen av `Schema NYBHLF` v.27–32 och jämför den genererade veckovyn cell för cell mot originalarket. Snapshot-test på fem veckor så senare ändringar inte tyst förskjuter innehållet.
- **Layoutfrihet:** bygg om tavlan till `Gävle lotsschema`-layouten (rader = ort, klockslag i cellen, ingen bilkolumn) *enbart via redigeringsläget*, utan kodändring. Går inte det är abstraktionen inte färdig.
- **Vy-växling:** samma vecka i bil-vy och person-vy ska visa samma tilldelningar; testas som property-test över importerad data.
- **Konfliktlogik:** enhetstester på fall som faktiskt förekommer i era filer — samma person på två rader (v.27 `Anders` på både `BT24/26` och `BT54/56` torsdag), person inplanerad under semestervecka, obemannad rad, samma förare på två olika tavlor.
- **API:** `GET /v1/alive` mot sandbox med hämtad token, därefter `GET /v1/vehicles` och verifiera att cursor-pagineringen följer `nextToken` korrekt över mer än en sida.
- **End-to-end (Playwright):** skapa vecka → dra förare från sidopanelen → byt bilnummer → lägg in semester → se konfliktvarningen → exportera PDF och Excel.
- **Acceptans hos planerare:** en trafikansvarig bygger sin egen tavla och lägger en skarp vecka parallellt med Excel. Går det snabbare och blir det rätt, är piloten godkänd.

## Öppna punkter

1. Vismas roadmap för shift/absence-endpoints — avgör om Fas 7 blir månader eller år av manuell inmatning.
2. Om TransPA har filimport för frånvaro, vilket skulle göra återläsningen automatisk redan i v1.
3. Om `/v1/employees` fungerar i er tenant trots `[Not ready]`-märkningen.
4. Ska en trafikansvarig kunna skapa *nya* tavlor själv, eller bara redigera de som en admin lagt upp?
5. Vmoschemas 4-veckors rullande grundschema (Pass 1–4, `Lists`-mappningen vecka → pass) ingår inte i v1 — det behöver en egen mall-funktion ovanpå tavlan och tas när piloten sitter.
6. Hosting: var appen ska köras och vem som administrerar den.
