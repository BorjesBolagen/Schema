# Designförhandsvisning

`veckotavlan.html` är en fristående, klickbar förhandsvisning av
gränssnittet — en enda HTML-fil utan bygg, server eller databas. Öppna
den i en webbläsare, eller använd den publicerade versionen.

Den finns för att designen ska gå att testa utan att installera något.
**Den är inte appen.** Logiken är återimplementerad i miniatyr och delar
ingen kod med `src/`, så den kommer att glida isär från appen så snart
något ändras där. Betrakta den som en skiss vid en viss tidpunkt.

Det den täcker:

- veckotavlan med dag- och nattskift, gruppering och konfliktmärkning
- bemanningspanelen med arbetsdagar och *Ej utlagda*
- dra och släpp: ut ur panelen, mellan celler, tillbaka för att ta bort
- *Fyll veckan* ur bas-schema och hämtade pass
- vy-växling mellan bilar och personer
- tavelredigering och bas-schema
- semesterårsvyn med dragmarkering och bemanningsräkning

Det den inte har: flera tavlor, personalväljaren, Excel-export, utskrift
och allt som rör TransPA. Ändringar sparas i webbläsarens lagring.
