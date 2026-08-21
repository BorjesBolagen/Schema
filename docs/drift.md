# Driftsättning

Next.js-app med Postgres bakom. Nedan står Supabase som databas och
Vercel som värd.

Uppsättningen kräver **ingen kommandorad**. Du klistrar in en SQL-fil i
Supabase, importerar repot i Vercel och skapar första kontot i
webbläsaren.

## 1. Databas i Supabase

Skapa ett projekt. **Välj region i Europa** — verktyget lagrar
personuppgifter om anställda, och de ska inte lämna EU utan att någon
fattat det beslutet medvetet.

Öppna **SQL Editor** och klistra in hela innehållet i
[`supabase-setup.sql`](supabase-setup.sql). Kör. Den skapar alla 18
tabeller och markerar migrationerna som körda, så en senare
`npm run db:migrate` inte försöker göra om det.

Hämta sedan anslutningssträngen under **Connection Pooling** — inte den
direkta på port 5432:

```
postgresql://postgres.PROJEKT:LÖSENORD@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

Den poolade anslutningen är inte en detalj. Vercel kör varje förfrågan i
en egen instans, och den direkta anslutningen tar slut på anslutningar
långt innan trafiken gör det. `src/db/index.ts` känner igen en poolad
sträng och stänger av både pool och förberedda satser, eftersom pgbouncer
i transaction mode inte klarar något av det.

Innehåller lösenordet tecken som `@`, `/`, `:` eller `#` måste de
procentkodas i URL:en. `&` fungerar som det är.

## 2. Vercel

Importera repot. Inga särskilda inställningar behövs. Lägg in
miljövariablerna:

| Variabel | Krävs | Kommentar |
|---|---|---|
| `DATABASE_URL` | ja | Den poolade Supabase-strängen |
| `TRANSPA_CLIENT_ID` | nej | När Visma beviljat access |
| `TRANSPA_CLIENT_SECRET` | nej | |
| `TRANSPA_TENANT_ID` | nej | |

Utan `DATABASE_URL` faller appen tillbaka på en inbäddad PGlite i en
katalog. Det fungerar lokalt men inte på Vercel, vars filsystem är
läsbart bara och vars instanser inte delar disk.

## 3. Första kontot

Öppna den driftsatta adressen. Är databasen tom leds du till
`/kom-igang`, där du skapar det första kontot. Det blir administratör
och kan sedan lägga upp övriga under **Användare**.

Sidan går inte att nå igen när kontot finns. **Gör det direkt efter
första deployen** — fram tills dess kan vem som helst som hittar
adressen skapa administratörskontot.

### Skapa ett konto direkt i databasen

Går det inte att nå `/kom-igang` — kontot finns redan, eller ni vill lägga
upp någon utan att logga in — går det att generera SQL i stället:

```bash
npx tsx scripts/make-user-sql.ts \
  --email namn@borjeskoncernen.se --name "Namn" --password "…" --role admin
```

Skriptet skriver ut en `INSERT` med lösenordet redan hashat. Lösenordet i
klartext hamnar aldrig i databasen och aldrig i SQL-filen. Satsen
uppdaterar ett befintligt konto med samma adress, så den fungerar även
för att återställa ett lösenord.

## 4. Första tavlan och grunddatan

Databasen är tom efter uppsättningen — TransPA-synken är inte på plats
än, och inget demounderlag följer med till drift.

1. **Grunddata** (adminmenyn på startsidan) → *Stationsorter*: lägg upp
   orterna. Det är dem personalväljaren filtrerar på.
2. **Grunddata → Personal** och **→ Fordon**: lägg upp dem som ska med.
   När TransPA-synken finns tar den över listorna; det som lagts in för
   hand ligger kvar vid sidan av.
3. Startsidan → **Ny tavla**: välj *Fjärr* eller *Distribution*, som är
   utgångslägen för veckodagar, skift och rader. Allt går att ändra
   efteråt under **⚙ Tavla**.
4. I tavlan: **👥 Bemanning** väljer vilka personer tavlan hanterar,
   **Bas-schema** kopplar person till bil, och **Arbetsmönster** anger
   vilka dagar var och en jobbar tills TransPA levererar det.

## 5. Användare och behörighet

Under **Användare** lägger en administratör upp konton.

- **Administratör** når alla tavlor och användarhanteringen.
- **Planerare** når bara de tavlor de tilldelats. En planerare utan
  tavlor ser ingenting — tillgång ges, den ärvs inte.

Kontot spärras i 15 minuter efter åtta felaktiga inloggningsförsök.

## Innan skarp personal läggs in

- Ett konto per trafikansvarig, inte ett delat.
- Bekräfta att Supabase-projektet ligger i EU.

Verktyget lagrar namn, anställningsnummer, stationsort och frånvaro med
orsak. Frånvaroorsaken är en uppgift om hälsa när den är *sjuk* eller
*vab*, och ska behandlas därefter.

## Lokalt

```bash
npm install
npm run demo     # demounderlag och server, konto skrivs ut i terminalen
```

Utan `DATABASE_URL` används en inbäddad PGlite i `.pgdata`, så varken
databasserver eller miljövariabler behövs.

## TransPA

`/transpa` frågar er tenant vad den faktiskt exponerar: hämtar
OpenAPI-specen, provar de dokumenterade endpointsen och provar dessutom
gissade namn för pass och frånvaro. Där finns också synken av grunddata.

Uppgifterna fås från Visma Developer Portal efter att organisationen
registrerats och access begärts. Scopen appen ber om står i
`src/lib/transpa/auth.ts`.

## Skript mot en riktig databas

`npm run seed` och `npm run db:migrate` läser `DATABASE_URL`. Sätt den i
kommandot, annars går de mot den lokala `.pgdata`-katalogen:

```bash
DATABASE_URL='postgresql://…pooler.supabase.com:6543/postgres?pgbouncer=true' npm run seed
```

Demounderlaget läggs bara i en tom databas. Innehåller den redan personal
avbryter skriptet i stället för att krocka med befintliga rader.

## När schemat ändras

```bash
npm run db:generate    # ny migration ur src/db/schema.ts
npm run db:setup-sql   # uppdaterar docs/supabase-setup.sql
```

Kör sedan `npm run db:migrate` mot `DATABASE_URL`, eller klistra in den
nya migrationen i Supabases SQL-editor.
