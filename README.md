# Schema

Schemaverktyg för chaufförer. Planeringen sker här; TransPA är kvar som
system för tidrapportering och lön, och är sanningen om hur varje person
jobbar.

Bakgrunden och hela utvecklingsplanen finns i [`docs/plan.md`](docs/plan.md).

## Hur det hänger ihop

**Bas-schemat kopplar person till bil — aldrig till dagar.** Vilka dagar
en person står på sin bil avgörs av personens arbetsdagar. Det är därför
BT13/14 bemannas av Björn måndag, tisdag, torsdag, fredag och av Roger
onsdag utan att någon skrivit in det per dag: båda är kopplade till
bilen, och deras arbetsdagar gör resten.

*Fyll veckan* sätter ihop de två. Den rör aldrig ett pass som ändrats
för hand och kan tryckas om när arbetsdagarna ändrats. Den bemannar
heller inte någon som är ledig.

**Arbetsdagarna ska komma från TransPA.** Tills hämtningen finns läses
de ur ett arbetsmönster i appen — en cykel på 1–8 veckor, vilket täcker
både vanliga veckoscheman och roterande upplägg. `CompositeWorkDayProvider`
faller tillbaka **per person**, så övergången till TransPA kan ske en
person i taget.

## Kom igång

```bash
npm install
npm test
npm run seed -- --db ./.pgdata     # demounderlag, inte kunddata
PGLITE_DIR=./.pgdata npm run dev
```

Utan `DATABASE_URL` körs [PGlite](https://pglite.dev) — en inbäddad
Postgres — så tester och utveckling fungerar utan databasserver. Sätt
`DATABASE_URL` till en postgres-URL i drift.

```bash
npm run db:generate   # ny migration efter ändring i src/db/schema.ts
npm run typecheck
```

## Vad en trafikansvarig sätter upp själv

Tre knappar i verktygsraden, ingen av dem kräver en utvecklare:

**⚙ Tavla** — radernas namn, ordning (dra), gruppering, färg och vilken
bil varje rad står för, samt vilka veckodagar och skift tavlan visar och
vilka fält som syns i cellen. En rad kan *avslutas* med ett datum i
stället för att raderas, så en inställd linje inte tar sin historik med
sig.

**Bas-schema** — kopplar person till bil. Inga dagar anges här; flera
personer får kopplas till samma rad och deras arbetsdagar avgör vem som
står där vilken dag.

**Arbetsmönster** — vilka dagar och skift en person jobbar, som en cykel
på 1–8 veckor. Ersätts av TransPA-hämtningen per person när den finns.

## Att arbeta i veckovyn

- Dra en person från sidopanelen till en cell för att lägga ut ett pass.
- Dra ett pass till en annan cell för att flytta det, till en annan bil,
  en annan dag eller båda. Håll ⇧ för att kopiera i stället.
- Dra ett pass tillbaka till sidopanelen för att ta bort det.
- Otillåtna släppzoner markeras rött redan under dragningen, med orsaken
  utskriven — problemet ska synas innan man släpper, inte efter.

Sidopanelens **Ej utlagda** listar dem som jobbar men ännu inte står på
någon bil. När den är tom är veckan bemannad, vilket gör panelen till
veckans kvitto och inte bara en lista att dra ur.

Samma vecka kan visas med bilarna som rader eller med personerna som
rader. Personvyn är en vy av samma pass, inte en andra kopia.

## TransPA-API:t

Bas-URL `https://api.mytranspa.com/publicApi`. Auth är OAuth2
`client_credentials` mot `https://connect.visma.com/connect/token` med
`scope=transpaapi:api …` och `tenant_id` — machine-to-machine, en token
per tenant. Cursor-paginering via `?cursor={nextToken}` och en filter-DSL
med `$eq $ne $gt $gte $lt $lte $in $nin` samt `$and: $or:`.

Bekräftade endpoints: `/v1/alive`, `/v1/connectUsers`, `/v1/employees`
(märkt `[Not ready]`), `/v1/stationPlaces`, `/v1/trafficAreas`,
`/v1/vehicleGroups`, `/v1/vehicles`, `/v1/workTasks`, `/v1/trips`,
`/v1/salaries/{id}`.

**Vismas genererade C#-klient är föråldrad** — den saknar `/v1/trips`,
som deras egna Postman-exempel anropar. Det går därför inte att av
klienten avgöra om schema- eller frånvaro-endpoints finns. Den levande
specen ligger på `api.mytranspa.com/doc/openapi/swaggerui/` och behöver
läsas innan `TranspaWorkDayProvider` skrivs.

## Test

```bash
npm test                                   # enhetstester
npx tsx scripts/e2e-fill.ts                # fyll veckan i en riktig webbläsare
npx tsx scripts/e2e-drag.ts                # dra ut och flytta pass
npx tsx scripts/e2e-editor.ts              # bygg om tavlan, mönster, bas-schema
npx tsx scripts/screenshot.ts <url> <fil>  # bild av en vy
```

E2E-skripten kräver att utvecklingsservern kör; sätt `BASE_URL` om den
ligger på en annan port. `e2e-editor.ts` är acceptanstestet för
layoutfriheten: det bygger om tavlan, ger en person ett mönster, kopplar
hen till en ny rad och kontrollerar att veckan bemannas — allt genom
gränssnittet, utan kodändring.
