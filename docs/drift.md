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
läsbart bara och vars instanser inte delar disk — där ger det i stället
`Application error: a server-side exception has occurred`.

Kopplade du Supabase till Vercel via deras integration i stället för
att klistra in strängen ovan för hand, letar appen även efter
`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` och `POSTGRES_PRISMA_URL` —
namnen integrationen brukar sätta. Är ingen av dem den poolade strängen
på port 6543 (eller `pgbouncer=true`) håller anslutningen ändå på att ta
slut under trafik; sätt `DATABASE_URL` till den poolade strängen
uttryckligen om så är fallet.

### Felsöka "Application error"

Sidans felmeddelande säger bara att något gick fel server-side — orsaken
står i **Vercel → Deployments → din deploy → Runtime Logs**. De vanligaste:

- **`Ingen databasanslutning hittades`** — ingen av variablerna ovan är
  satt. Lägg in `DATABASE_URL` under Project Settings → Environment
  Variables och deploya om.
- **Ett fel från `postgres`-drivrutinen** (`password authentication
  failed`, `SASL`, `timeout`) — fel lösenord, eller specialtecken i det
  som inte procentkodats (`@ / : #`), eller att den direkta anslutningen
  på port 5432 använts i stället för den poolade på 6543.
- **`relation "..." does not exist`** — `supabase-setup.sql` har inte
  körts i det projektet, eller `DATABASE_URL` pekar på fel Supabase-
  projekt.

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
4. I tavlan: **👥 Bemanning** väljer vilka personer tavlan hanterar —
   filtrera på stationsort och *Välj alla*.
5. **Arbetsmönster**: klicka i måndag–fredag och tryck *Använd på N
   personer*. Det lägger mönstret på alla i bemanningen som saknar ett.
   Justera sedan de få som kör annorlunda, en i taget.
6. **Bas-schema** kopplar person till bil — inga dagar anges, det avgör
   arbetsdagarna. Därefter fyller **Fyll veckan** tavlan.

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

### Skaffa uppgifterna

Tre värden krävs: `TRANSPA_CLIENT_ID`, `TRANSPA_CLIENT_SECRET`,
`TRANSPA_TENANT_ID`. De skapas i två separata steg i Visma Developer
Portal (`oauth.developers.visma.com`) — det första skapar appen, det
andra kopplar den till er TransPA-tenant. Namn på knappar kan skilja sig
något mot nedan om Visma ändrat gränssnittet, men flödet är detsamma.

**1. Skapa applikationen**

1. Logga in på Visma Developer Portal med ett konto knutet till Börjes
   som organisation — skapa ett om det inte finns.
2. **My Applications** → **Add application**.
3. Välj typen **Service** (maskin-till-maskin, `client_credentials`) —
   inte Web eller SPA, de är för inloggning av en person.
4. Fyll i namn (t.ex. "Schema — Börjes") och beskrivning. Client ID
   sätts eller genereras här — spara det, det blir `TRANSPA_CLIENT_ID`.
5. Spara/publicera appen. Öppna sedan fliken **Credentials** och tryck
   **Generate Secret**. Secreten visas bara en gång — spara den direkt,
   det blir `TRANSPA_CLIENT_SECRET`.

**2. Begär access till TransPA Public API**

6. Hitta **TransPA Public API** i API-katalogen och begär access för
   appen ni just skapade, med scopen som listas nedan.
7. Access till TransPA är **manuell**, inte automatisk — Visma
   handlägger den och hör av sig via mejl. Det är det här steget som
   tar kalendertid, så skicka begäran även om ni inte hunnit klart med
   allt annat.
8. När Visma beviljat access: appen behöver kopplas till er TransPA-
   tenant, normalt genom att en administratör för er TransPA-tenant
   godkänner appen (i Visma App Store eller motsvarande admin-vy Visma
   anvisar i mejlet). Det är det steget som ger er `tenant_id` — det
   blir `TRANSPA_TENANT_ID`.

Scopen att begära, så en andra ansökningsrunda inte behövs:

```
transpaapi:api
transpaapi:employees:read
transpaapi:vehicles:read
transpaapi:vehiclegroups:read
transpaapi:trafficareas:read
transpaapi:stationplaces:read
transpaapi:worktasks:read
transpaapi:trips:read
```

(Samma lista står i `src/lib/transpa/auth.ts` — om den ändras där ska
den ändras här också.)

**3. Koppla in och testa**

9. Lägg de tre värdena som miljövariabler i Vercel (Project Settings →
   Environment Variables) och deploya om.
10. Besök `/transpa` som administratör. Sidan visar om token- och
    scope-uppsättningen fungerar, och fältnamnen från `/v1/trips` och
    `/v1/employees` om anropen lyckas.

Fungerar inte token-hämtningen (`/transpa` visar "Fel" på Token) är det
nästan alltid client id, secret eller tenant id som skrivits fel av, eller
att scopen inte hunnit beviljas än — vänta och ladda om.

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
