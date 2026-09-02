# TransPA Public API — vad det faktiskt har

Nedtecknat ur Vismas egen Swagger-UI, utskriven 2026-09-02
(`api.mytranspa.com/doc/openapi/swaggerui/`). Finns här för att den
adressen inte går att nå från utvecklingsmiljön — nätverkspolicyn
blockerar `api.mytranspa.com` — och för att varje anrop mot API:t
belastar en anropskvot som redan tagit slut en gång.

Vismas genererade C#-klient (`TransPA-Public-API-Client`, 0.1.21) duger
inte som facit: den saknar `/v1/trips`, som deras egna Postman-exempel
anropar. Den här filen och den hämtade specen gäller.

## Grundfakta

| | |
|---|---|
| Bas-URL | `https://api.mytranspa.com/publicApi` |
| Auth | OAuth2 `client_credentials` mot `https://connect.visma.com/connect/token` |
| Scope | `transpaapi:api` alltid, plus resursens eget |
| Paginering | `?cursor={nextToken}`, `limit` max 100 |
| Listsvar | Raderna ligger under `items` |
| Fel | `application/problem+json`: `{title, status, detail}` |

## Två beteenden som kostar tid att upptäcka

**404 betyder ofta "ofullständig begäran", inte "finns inte".**
`GET /v1/shifts/` svarar 404 utan `startDateTimeAfter` och
`startDateTimeBefore`. Det fick vägen att se ut som att den inte fanns.
Samma sak gäller skrivvägarna, som kräver `checkSum`.

**429 säger hur länge kvoten är slut.** Kroppen är
`Out of call volume quota. Quota will be replenished in 1.16:10:17`
— .NET:s TimeSpan-format, `[dygn.]tt:mm:ss`.

## Att skriva ett pass

Två parametrar, inte en:

```
PUT /v1/shifts/{id}
  id        (path)   Resource ID
  checkSum  (query)  Checksum retrieved from calculateAdjustedWorkTime
```

`POST /v1/shifts/` kräver samma `checkSum`.

Skälet är `adjustedWorkTimeInMinutes`. Fältet är *arbetad* tid — passets
längd minus rasterna — och avräkningen beror på tenantens
tidrapportinställningar. En klient får därför inte hitta på värdet: man
skickar passet till `POST /v1/calculateAdjustedWorkTime`, får tillbaka
minuterna och en summa som kvitterar dem, och skickar båda vidare.

Kroppen ersätter hela passet. Ett utelämnat fält är ett raderat fält.

```
startDateTime*              date-time
breaks*                     [{ startDateTime, endDateTime }]
partsOfDay*                 [{ endDateTime, vehicleId, workTaskId,
                               customCounters, trailerVehicleId,
                               costDistributionCode }]
adjustedWorkTimeInMinutes*  1–1440
id, employeeId, externalId (5–50 tecken), name (≤80),
description (≤1000), isExtraShift
```

Rasterna bär egna tidpunkter. Flyttas ett pass måste de flyttas lika
mycket, annars ligger rasten kvar på det gamla dygnet — och då kvitterar
checksumman fel pass.

## Vägarna

Läsning om inget annat sägs.

| Område | Vägar |
|---|---|
| Personal | `/v1/employees`, `/v1/employees/{id}`, `/v1/employees/{id}/salaryConfiguration` (GET, PUT) |
| Pass | `/v1/shifts/` (GET, POST), `/v1/shifts/{id}` (GET, PUT, DELETE), `/v1/employees/{id}/shifts/` |
| Tidrapporter | `/v1/timeReports` (GET, POST), `/v1/timeReports/{id}` (GET, PUT, DELETE), `/v1/employees/{id}/timereports/`, `/v1/timereportConfiguration/` |
| Arbetstid | `/v1/calculateAdjustedWorkTime` (POST) |
| Turer | `/v1/trips` (GET, POST), `/v1/trips/{id}` (GET, PUT, DELETE) |
| Fordon | `/v1/vehicles` (GET, POST), `/v1/vehicles/{id}` (GET, PUT, DELETE), `/v1/vehicleGroups` |
| Organisation | `/v1/stationPlaces`, `/v1/trafficAreas`, `/v1/workGroups`, `/v1/workTasks` |
| Löner | `/v1/salaries/{id}`, `/v1/salaries/{id}/setExportFailed`, `/v1/salaries/{id}/setExportSuccess`, `/v1/subscribe/salaries`, `/v1/unsubscribe/salaries` |
| Färdskrivare | `/v1/tachographData` (POST; GET ej klar), `/v1/tachographDataAbstractions`, `/v1/employees/{id}/preliminaryTachographData/` (ej klar) |
| Filer | `/v1/files`, `/v1/files/{id}` — båda märkta *Not Ready* |

## Frånvaro och semester finns inte

Varken som väg eller som modell. Schemalistan i Swagger — som är hela
modellinventariet — innehåller:

> address, employee, employeeContract, httpHeader, money, weekday,
> adjustedWorkTime, wageRow, timeRow, file, salary, salaryCreated,
> salaryConfiguration, salaryExportFailed, shift, stationPlace,
> tachographDataAbstraction, timeReport, webHook, tachographData,
> preliminaryTachographData, timereportConfiguration, trafficArea, trip,
> vehicle, vehicleGroup, workGroup, workTask, cursor, problem

Ingen `absence`, ingen `vacation`, ingen `leave`. Specen hämtas dessutom
oautentiserat, så listan är inte filtrerad på våra behörigheter — det är
allt som finns.

**Följden:** punkt 4 på önskelistan, att skicka frånvaro tillbaka till
TransPA, går inte att bygga mot det publika API:t. Frånvaron ägs här,
och den som vill ha den i TransPA får föra in den där för hand tills
Visma öppnar en väg. Frågan är värd att ställa till dem — men den är
inte en utvecklingsuppgift.
