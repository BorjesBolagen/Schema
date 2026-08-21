# Driftsättning

Appen är en vanlig Next.js-app med en Postgres bakom sig. Nedan står
Supabase som databas och Vercel som värd, eftersom det är vad som valts.

## 1. Databas i Supabase

Skapa ett projekt och hämta anslutningssträngen under **Connection
Pooling** — inte den direkta på port 5432.

```
postgresql://postgres.PROJEKT:LÖSENORD@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

Den poolade anslutningen är inte en detalj. Vercel kör varje förfrågan i
en egen instans, och den direkta anslutningen tar slut på anslutningar
långt innan trafiken gör det. `src/db/index.ts` känner igen en poolad
sträng och stänger av både pool och förberedda satser, eftersom pgbouncer
i transaction mode inte klarar något av det.

Välj region i Europa. Personuppgifter om anställda ska inte lämna EU utan
att någon fattat det beslutet medvetet.

## 2. Migrera

Körs från din egen dator, inte från Vercels byggsteg — ett bygge kan
starta flera gånger parallellt och en migration ska inte göra det.

```bash
DATABASE_URL='...' npm run db:migrate
```

## 3. Första användaren

```bash
DATABASE_URL='...' SEED_ADMIN_EMAIL=du@borjeskoncernen.se \
  SEED_ADMIN_PASSWORD='något-långt-och-eget' npm run seed
```

Seed-skriptet lägger även upp demounderlaget. Vill ni ha en tom databas
med bara inloggningen, ta bort raderna efter användaren i
`scripts/seed-demo.ts` — eller lägg upp demot först, titta på det och
töm tabellerna sedan.

## 4. Vercel

Importera repot. Inga särskilda inställningar behövs; Next känns igen av
sig självt. Lägg in miljövariablerna:

| Variabel | Krävs | Kommentar |
|---|---|---|
| `DATABASE_URL` | ja | Den poolade Supabase-strängen |
| `TRANSPA_CLIENT_ID` | nej | När access beviljats |
| `TRANSPA_CLIENT_SECRET` | nej | |
| `TRANSPA_TENANT_ID` | nej | |

Utan `DATABASE_URL` faller appen tillbaka på en inbäddad PGlite i en
katalog — det fungerar lokalt men inte på Vercel, vars filsystem är
läsbart bara och vars instanser inte delar disk. Sätt den.

## 5. Innan skarp personal läggs in

- Byt admin-lösenordet från det som seedades.
- Lägg upp ett konto per trafikansvarig i stället för ett delat.
- Bekräfta att Supabase-projektet ligger i EU.

Verktyget lagrar namn, anställningsnummer, stationsort och frånvaro med
orsak. Frånvaroorsaken är en uppgift om hälsa när den är *sjuk* eller
*vab*, och ska behandlas därefter.

## TransPA

`/transpa` i appen frågar er tenant vad den faktiskt exponerar: hämtar
OpenAPI-specen, provar de dokumenterade endpointsen och provar dessutom
ett antal gissade namn för pass och frånvaro. Sidan är den snabbaste
vägen till svaret på om arbetsdagarna går att hämta.

Uppgifterna fås från Visma Developer Portal efter att organisationen
registrerats och access begärts. Scopen appen ber om står i
`src/lib/transpa/auth.ts`.
