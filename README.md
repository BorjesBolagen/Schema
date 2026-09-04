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

## Testa designen utan att installera något

[`docs/prototyp/veckotavlan.html`](docs/prototyp/veckotavlan.html) är en
fristående klickbar förhandsvisning av gränssnittet — en HTML-fil som
öppnas direkt i en webbläsare. Den delar ingen kod med appen och är en
skiss vid en viss tidpunkt, inte en andra sanning. Se
[`docs/prototyp/README.md`](docs/prototyp/README.md).

## Kom igång

```bash
npm install
npm run demo
```

Öppna sedan <http://localhost:3000> och logga in med uppgifterna som
skrivs ut av seed-skriptet (`admin@example.se` / `schema-demo-2026` om inget
annat anges). `npm run demo` lägger upp ett
demounderlag och startar appen med några veckor redan bemannade, så det
går att klicka runt direkt. Underlaget är påhittat — skarp personal och
skarpa fordon kommer från TransPA-synken.

Utan `DATABASE_URL` körs [PGlite](https://pglite.dev), en inbäddad
Postgres i katalogen `.pgdata`, så varken databasserver eller
miljövariabler behövs. Sätt `DATABASE_URL` till en postgres-URL i drift.

`npm run seed` lägger upp underlaget igen utan att starta servern.

```bash
npm test              # enhetstester
npm run typecheck
npm run db:generate   # ny migration efter ändring i src/db/schema.ts
```

## Vad en trafikansvarig sätter upp själv

Tavlorna skapas från startsidan med **Ny tavla** — namn plus ett av två
utgångslägen, *Fjärr* (söndag–fredag, dag och natt) eller *Distribution*
(måndag–fredag, bara dag). Utgångsläget bestämmer bara vad tavlan börjar
med; därefter styr tavelredigeraren allt.

Personal, fordon och stationsorter ska komma från TransPA-synken. Tills
den finns lägger en administratör upp dem under **Grunddata**.

Tre knappar i verktygsraden, ingen av dem kräver en utvecklare:

**⚙ Tavla** — radernas namn, ordning (dra), gruppering, färg och vilken
bil varje rad står för, samt vilka veckodagar och skift tavlan visar och
vilka fält som syns i cellen. En rad kan *avslutas* med ett datum i
stället för att raderas, så en inställd linje inte tar sin historik med
sig.

**Bas-schema** — kopplar person till bil. Inga dagar anges här; flera
personer får kopplas till samma rad och deras arbetsdagar avgör vem som
står där vilken dag.

En tavla tas bort under **⚙ Tavla**, längst ned. Bekräftelsen räknar upp
vad som försvinner — rader, utlagda pass, bemanning och bas-schema.
Personal, fordon, arbetsmönster och registrerad frånvaro rörs inte:
frånvaron hör till personen, inte till den tavla hen råkade stå på. Bara
administratörer kan ta bort en tavla.

**Arbetsmönster** — vilka dagar och skift en person jobbar, som en cykel
på 1–8 veckor. *Använd på N personer* lägger samma mönster på hela
bemanningen på en gång — normalt bara på dem som saknar ett, så ingens
rullschema skrivs om av misstag. Ersätts av TransPA-hämtningen per
person när den finns.

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

## Semester och frånvaro

`Semester` i verktygsraden öppnar årsvyn: en rad per person, en ruta per
vecka. Dra över veckor för att markera, dra över markerade veckor igen
för att ta bort. Beviljad ritas heldraget och önskemål rastrerat.

Raden **Bemanning kvar** räknar hur många som är tillgängliga varje
vecka och färgar rött under den nivå ni satt — det som i Excel upptäcks
först när en vecka visar sig omöjlig att bemanna. *Fyll veckan* bemannar
aldrig någon som är ledig.

## Utskrift och export

`Skriv ut / PDF` använder webbläsarens egen utskrift. Sidan har en
utskriftslayout, så "Spara som PDF" ger exakt den layout trafikansvarig
byggt, i A4 liggande utan sidopanel och knappar.

`Excel` laddar ner veckan eller semesteråret som `.xlsx` med tavlans egen
radordning och gruppering.

## Drift

Se [`docs/drift.md`](docs/drift.md). Uppsättningen kräver ingen
kommandorad: klistra in [`docs/supabase-setup.sql`](docs/supabase-setup.sql)
i Supabases SQL-editor, sätt `DATABASE_URL` till den **poolade**
anslutningen i Vercel, och skapa första kontot på `/kom-igang` i
webbläsaren.

## Inloggning och behörighet

Inloggning per användare med sessioner i databasen. Lösenorden hashas med
scrypt; sessionstabellen lagrar bara en hash av token. Kontot spärras i
15 minuter efter åtta felaktiga försök.

Administratörer når alla tavlor och användarhanteringen under
**Användare**. Planerare når bara de tavlor de tilldelats — en planerare
utan tavlor ser ingenting, eftersom tillgång ska ges och inte ärvas.
Stängs ett konto av rivs dess sessioner samtidigt; annars skulle en
avstängd användare kunna arbeta vidare i upp till trettio dagar på en
redan utfärdad kaka.

Mellanvaran skickar utloggade till inloggningen, men kör på Edge och når
inte databasen — den ser bara *att* en kaka finns. Den är alltså en
genväg, inte gränsen som håller: varje sida och server-action anropar
`requireUser()`, och det är där behörigheten kontrolleras.

**Kan man logga in med TransPA-kontot?** Inte via TransPA:s Public API.
Det stödjer bara `client_credentials`, alltså maskin-till-maskin, och den
grant-typen har ingen användare. `/v1/connectUsers` finns men är märkt
"intended for internal Visma use only" och returnerar bara ett
`ConnectId` — inget namn, ingen e-post. Visma Connect är däremot en riktig
OIDC-leverantör, så inloggning via den vore i princip möjlig om Visma
tillåter det. `app_user.connect_user_id` finns redan för den kopplingen.
Frågan behöver ställas till Visma tillsammans med API-ansökan.

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
klienten avgöra om schema- eller frånvaro-endpoints finns.

Sidan `/transpa` i appen svarar på den frågan mot er egen tenant: den
hämtar OpenAPI-specen, provar de dokumenterade endpointsen och provar
dessutom några gissade namn för pass och frånvaro. Där finns också en
knapp för att synka grunddata — personal, fordon, fordonsgrupper,
trafikområden och stationsorter. Bilarnas visningsnamn och personalens
stationsort ägs lokalt och skrivs aldrig över av synken.

`TranspaWorkDayProvider` är medvetet inte skriven än. Vilken endpoint som
ger planerade pass — om någon gör det — avgörs av diagnostiken, och först
då går det att skriva den mot något verkligt.

## Test mot riktig Postgres

PGlite räcker för utveckling, men drivrutinen är en annan än i drift.
Hela flödet är verifierat mot PostgreSQL 16 via postgres-js — inloggning,
uppsättning, bemanning, dra och släpp, semestervyn och exporten.

```bash
./scripts/local-postgres.sh start     # skriver ut en DATABASE_URL
DATABASE_URL='...' npm run seed
DATABASE_URL='...' npm run dev
./scripts/local-postgres.sh stop
```

## Test

```bash
npm test                                   # enhetstester
npx tsx scripts/e2e-fill.ts                # fyll veckan i en riktig webbläsare
npx tsx scripts/e2e-drag.ts                # dra ut och flytta pass
npx tsx scripts/e2e-editor.ts              # bygg om tavlan, mönster, bas-schema
# Kräver en databas utan tavlor — annars står inte formuläret öppet:
#   rm -rf .pgdata && npx tsx scripts/seed-tom.ts
npx tsx scripts/e2e-tomstart.ts            # tom databas → bemannad vecka
npx tsx scripts/e2e-radera.ts              # ta bort en tavla, se att rätt saker överlever
npx tsx scripts/screenshot.ts <url> <fil>  # bild av en vy
```

E2E-skripten kräver att utvecklingsservern kör; sätt `BASE_URL` om den
ligger på en annan port. `e2e-editor.ts` är acceptanstestet för
layoutfriheten: det bygger om tavlan, ger en person ett mönster, kopplar
hen till en ny rad och kontrollerar att veckan bemannas — allt genom
gränssnittet, utan kodändring.
