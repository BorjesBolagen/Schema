# Schema

Schemaverktyg för chaufförer. Planeringen sker här; TransPA är kvar som
system för tidrapportering och lön.

Bakgrunden och hela utvecklingsplanen finns i [`docs/plan.md`](docs/plan.md).

## Varför verktyget äger schemat

TransPA:s publika API har i dag inga endpoints för schema, pass,
frånvaro eller semester — bara fordon, trafikområden, stationsorter,
arbetsuppgifter, personal (märkt `[Not ready]`) och löneexport. Därför
går det inte att hämta schemat ur TransPA, och verktyget måste ha en
egen datamodell. Grunddata synkas från TransPA; frånvaro skrivs tillbaka
via en adapter som byts ut när Visma släpper endpoints.

## Kom igång

```bash
npm install
npm test
```

Utan `DATABASE_URL` körs [PGlite](https://pglite.dev) — en inbäddad
Postgres — så tester och import fungerar utan databasserver. Sätt
`DATABASE_URL` till en postgres-URL i drift.

```bash
npm run db:generate   # ny migration efter ändring i src/db/schema.ts
npm run typecheck
```

## Importera befintliga Excel-scheman

```bash
npm run import -- --file /sökväg/till/Schema.xlsx --db ./.pgdata
```

Skriptet läser bladen `Personallista` och `Schema NYBHLF`, skapar två
tavlor (dagschema måndag–fredag och veckoschema söndag–fredag) och
rapporterar hur mycket som gick att koppla.

**Källfilerna hör inte hemma i repot.** `Personallista` innehåller
personnummer, hemadresser och förarkortnummer. Importen läser medvetet
inte de fälten — bara namn, anställningsnummer, signatur, kontaktväg och
grupptillhörighet — men filen som helhet ska ligga utanför versions-
hanteringen. `data/` är ignorerad och är en lämplig plats.

### Vad importen visar om underlaget

Körningen mot dagens fil ger runt 46 % respektive 61 % automatiskt
kopplade förare. Resten beror på underlaget, inte på tolkningen:

- **Personallistan är äldre än schemat.** Namn som förekommer flitigt i
  schemat — Teodor, Josefin, Oliver, Malte, Leo, Therese, Glenn, Jarek —
  saknas helt i personallistan.
- **Smeknamn går inte att härleda.** "Elle", "Mylla", "Chrille",
  "Berra", "CK", "MP" finns inte i något namnfält. De kopplas en gång av
  en människa och sitter sedan.
- **Förnamn är tvetydiga.** Nio personer heter Johan, åtta Magnus, sex
  Anders. Importen vägrar gissa och listar dem i stället.

Allt som inte kunde kopplas hamnar i tabellen `unresolved_alias` med
antal förekomster, för manuell koppling i appen. Ingen celltext kastas
bort: texten sparas som notering på tilldelningen även när namnet inte
kunde tydas.

### Datumen i bladet stämmer inte

55 av 82 veckoblock har datumceller som inte hör ihop med sitt eget
veckonummer. Blocken har kopierats framåt utan att datumraden
uppdaterades — 2026-avsnittet står med "Vecka 27" men datumen
2025-06-29 och framåt, ett år och en dag fel.

Importen läser därför inte datumcellerna. Den räknar datumet ur
veckonumret och veckodagsrubriken, som båda stämmer, och rapporterar
hur många block som avvek. Samma sak gör att högerblockets varierande
bredd hanteras: 2026-avsnittet har en extra kolumn och inleds på
lördag i stället för söndag, vilket läses av rubrikraden i stället för
att antas.

Verifiera underlaget med:

```bash
npx tsx scripts/verify-import.ts --file /sökväg/till/Schema.xlsx
```

Skriptet visar konflikter i den importerade perioden. På veckorna 27–32
2025 ger det ett tiotal dubbelbokningar — bland dem linjen `BT24/26`,
som visar sig finnas på *båda* Excel-blocken. Samma tur underhålls
alltså på två ställen i dag.

Semesterrutan i Excel är inte ett tillförlitligt underlag — bara 14 av
82 veckoblock har någon rubrik alls, och rutan innehåller ibland listor
över *tillgänglig* personal. Därför importeras bara de entydiga
formuleringarna ("`<namn>` hela veckan", "`<namn>` tis"); resten lämnas
till granskning hellre än att någon felaktigt markeras som ledig.
