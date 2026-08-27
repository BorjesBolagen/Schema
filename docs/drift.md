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

Importera repot. `vercel.json` pekar redan ut Dublin (`dub1`) som
funktionsregion — Vercels närmaste till Supabases `eu-west-1`. Utan den
körs funktionerna i Vercels standardregion i USA, och varje
databasfråga blir en transatlantisk tur och retur i stället för en
inom Europa; det gjorde databasanrop ovanligt känsliga för att hänga.
Kontrollera under **Project Settings → Functions → Function Region**
att den faktiskt fått verkan efter första deployen — annars sätt den
där för hand.

`/db-health` (adminmenyn på startsidan) testar kopplingen direkt: tre
enkla frågor, en i taget, med var sin tid. Snabbare väg till att veta om
kopplingen själv är trög än att gå via en tavla.

Lägg in miljövariablerna:

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
- **`SELF_SIGNED_CERT_IN_CHAIN`** — rättat i koden (`src/db/index.ts`,
  `sslSetting()`). Berodde inte på anslutningssträngen utan på hur
  `postgres`-drivrutinen tolkar TLS-läget: bara strängen `"require"`
  stänger av certifikatverifieringen, det booleska `true` gör det inte
  och Nodes strikta standard klarar inte Supabase poolers certifikat.
  Ser du felet ändå, kör ni en äldre deploy än den här fixen — deploya
  om.
- **Sidan hänger länge och kraschar sedan** (`Vercel Runtime Timeout
  Error: Task timed out after 300 seconds`, eller ett oläsligt
  client-side-fel i webbläsaren) — en databassockel har dött tyst.
  `postgres`-drivrutinen har ingen lässtidsgräns: dör sockeln utan att
  motparten hinner säga till — precis vad som händer när Vercel fryser
  en instans mellan två anrop, eller när en brandvägg glömmer bort
  anslutningen — skickas frågan i väg och svaret kommer aldrig.
  `readWithTimeout()` i `src/db/index.ts` hanterar det: den ger upp
  efter sex sekunder, pensionerar kopplingen och gör om läsningen på en
  färsk. Alla sidors läsvägar går genom den. Gör du en ny sida som
  läser ur databasen, lägg den bakom `readWithTimeout()` också.
- **Bara tavelvyn hänger, andra sidor svarar** — parallella
  databasfrågor. Drivrutinen skickar dem pipelinade på samma
  anslutning, och Supabases pooler i transaction mode kan fastna när
  det blir för många på en gång. Tavelvyn körde sju parallellt och var
  den enda sidan som hängde; db-health (tre i följd) och semestervyn
  (två parallella) gjorde det aldrig. Alla databasfrågor körs därför
  numera **en i taget**. Varje fråga tar millisekunder, så hela vyn
  kostar under en tiondels sekund seriellt. Lägg inte tillbaka
  `Promise.all` runt databasfrågor.
- **`CONNECTION_DESTROYED`** — någon stängde den delade
  databaskopplingen medan en annan förfrågan använde den. Vercels
  "Fluid"-läge kan låta flera samtidiga förfrågningar dela samma
  körande instans och därmed samma koppling (`getDb()`), så inget som
  körs under en enskild förfrågan får stänga den. `readWithTimeout()`
  *byter ut* kopplingen mot en ny men stänger aldrig den gamla — den
  får dö av sig själv, så pågående frågor på den lever klart.
- **Ett fel från `postgres`-drivrutinen** (`password authentication
  failed`, `SASL`, `timeout`) — fel lösenord, eller specialtecken i det
  som inte procentkodats (`@ / : #`), eller att den direkta anslutningen
  på port 5432 använts i stället för den poolade på 6543.
- **`relation "..." does not exist`** — `supabase-setup.sql` har inte
  körts i det projektet, eller `DATABASE_URL` pekar på fel Supabase-
  projekt.

### Row Level Security

Supabase publicerar automatiskt ett REST-API för allt i schemat
`public`, nåbart med projektets **anon-nyckel** — och den nyckeln är
avsedd att vara publik. Utan Row Level Security kan alltså vem som helst
som känner till projektets adress både läsa och skriva. Det är inte
teoretiskt: `session` lagrar hashen av en sessionskaka, så den som kan
skriva där lägger in en egen rad mot en administratörs id och är
inloggad som administratör. `app_user` bär lösenordshashar, `absence`
bär sjukfrånvaro och vab.

`supabase-setup.sql` slår därför på RLS för varje tabell, utan en enda
policy, och tar bort de rättigheter Supabase ger `anon` och
`authenticated` som standard. Appen påverkas inte: den kopplar direkt
mot Postgres som rollen `postgres`, som äger tabellerna, och en ägare
går förbi RLS. Ingen `FORCE ROW LEVEL SECURITY` — det skulle gälla även
ägaren och stoppa appen.

Lägger du till en tabell: slå på RLS för den också. `src/db/rls.test.ts`
går sönder om du glömmer.

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
5. **Bas-schema** kopplar person till bil — inga dagar anges, det
   avgör arbetsdagarna.
6. **2 · Hämta schema** hämtar veckans pass ur TransPA för tavlans
   bemanning, en person i taget. Personer utan TransPA-koppling räknas
   upp i svaret. Därefter fyller **3 · Fyll veckan** tavlan utifrån de
   hämtade passen.

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
transpaapi:workgroups:read
transpaapi:stationplaces:read
transpaapi:worktasks:read
transpaapi:trips:read
transpaapi:shifts:read
```

(Samma lista står i `src/lib/transpa/auth.ts` — om den ändras där ska
den ändras här också.)

### Flera bolag

Ett bolag i TransPA = en tenant. Klient-id och hemlighet delas av alla
bolag — det är samma Visma-applikation som varje bolag i sin tur ger
tillgång via en inbjudningskod — så bara tenant-id skiljer.

Bolagen ligger i tabellen `transpa_tenant`. Är den tom men
`TRANSPA_TENANT_ID` satt läggs det bolaget upp automatiskt vid första
synken, så inget behöver fyllas i för att komma igång. Fler bolag läggs
till med en rad:

```sql
insert into transpa_tenant (tenant_id, name) values ('<tenant-id>', 'Bolagets namn');
```

Modellen följer verkligheten: **en person tillhör exakt ett bolag** och
kan aldrig finnas i två. En *tavla* kan däremot behöva folk från två
bolag — på orter där två bolag samarbetar om samma trafik — så tavlan
låses aldrig till ett bolag; kopplingen sitter på personen.

Därför är anställningsnummer unika **per bolag**, inte globalt: två
bolag har med stor sannolikhet varsin 2262, och en global unik nyckel
hade stoppat synken för det andra bolaget.

**Fordon hämtas inte** från TransPA. De skrivs in för hand under
Grunddata; ni äger bilnumren själva. Kan ändras senare — scopet finns.

Synken hämtar bara det ni har scope för. `trafficareas` och
`vehiclegroups` finns i Vismas föråldrade klient men beviljades aldrig,
så de hoppas över i stället för att misslyckas med 403 vid varje
körning — `SCOPE_FOR` i `src/server/transpa-sync.ts` styr det, och
läser scopen ur samma lista som resten av koden. Får ni fler scopes
beviljade räcker det att lägga till dem i `READ_SCOPES`.

**Vad tenanten faktiskt svarade** (2026-08-25, via `/transpa`):

| Väg | |
|---|---|
| `/v1/alive`, `/v1/employees`, `/v1/vehicles`, `/v1/stationPlaces`, `/v1/workTasks`, `/v1/workGroups`, `/v1/trips` | svarar |
| `/v1/shifts` | **404** — trots att scopet är beviljat |
| `/v1/vehicleGroups`, `/v1/trafficAreas` | nekas, inget scope |
| `/v1/schedules`, `/v1/absences`, `/v1/timeReports`, `/v1/workSchedules` | finns inte |

Att `shifts` har ett beviljat scope men ingen väg på `/v1/shifts` är
det som avgör nästa steg: resursen finns, men ligger någon annanstans —
troligast under personen den gäller. `/transpa` provar därför en rad
kandidater, och de som är underresurser provas mot en riktig person
hämtad ur `/v1/employees`. Hittas ingen väg är `/v1/trips` reserven att
härleda arbetsdagar ur.

Listan ovan är rättad mot Börjes verkliga scope-katalog i Visma
Developer Portal (2026-08-24): resursen heter `workgroups`, inte
`vehiclegroups` som den föråldrade klienten antydde, och `trafficareas`
finns inte som egen scope alls. Viktigast: **`shifts` finns.** TransPA
har alltså en riktig schema-resurs — det var den öppna frågan som
avgjorde hur mycket arbetsmönstren i verktyget skulle behövas, och
svaret är att de blir en parentes i stället för grunden. Write-scopen
för employees, vehicles, shifts och trips beviljades också men begärs
inte av koden än — appen skriver ingenting till TransPA förrän
frånvaro/semester-vägen (Fas 8) faktiskt byggs.

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
