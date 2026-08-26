-- Yrkesroll från TransPA.
--
-- Körningen mot Börjes tenant 2026-08-26: 281 chaufförer, 18 "other"
-- och 2 "garage" av 301 personer. Fältet finns för att de tjugo som
-- inte kör ska gå att sortera bort när ett schema läggs — inte för att
-- det säger något om var någon är stationerad. Det gör det inte:
-- varken professionGroup eller grouping bär ort, och grouping är tomt
-- för samtliga.

ALTER TABLE "employee" ADD COLUMN IF NOT EXISTS "profession_group" text;
