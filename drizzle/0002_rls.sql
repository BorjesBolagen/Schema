-- Stäng ute Supabases publika API från alla tabeller.
--
-- Supabase publicerar automatiskt ett REST-API för allt i schemat
-- public, nåbart med anon-nyckeln — och den nyckeln är avsedd att vara
-- publik, den ligger i webbläsaren hos den som använder ett
-- Supabase-projekt på vanligt vis. Utan Row Level Security kan alltså
-- vem som helst som känner till projektets adress läsa OCH skriva.
--
-- Det är inte teoretiskt: tabellen session lagrar hashen av en
-- sessionskaka. Den som kan skriva där lägger in en egen rad mot en
-- administratörs användar-id och är därmed inloggad som administratör.
-- app_user bär lösenordshashar, absence bär sjukfrånvaro och vab.
--
-- Den här appen använder aldrig det API:t. Den kopplar direkt mot
-- Postgres som rollen postgres, som äger tabellerna — och en ägare går
-- förbi RLS. Att slå på RLS utan en enda policy stänger därför dörren
-- helt för det publika API:t utan att appen märker något.
--
-- Ingen FORCE ROW LEVEL SECURITY: det skulle låta RLS gälla även
-- ägaren, och då skulle appen sluta fungera.

ALTER TABLE "absence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "base_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_crew" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_row" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "station_place" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "traffic_area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transpa_tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_pattern" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_pattern_day" ENABLE ROW LEVEL SECURITY;

-- Bälte och hängslen: ta även bort de rättigheter Supabase ger anon och
-- authenticated som standard. RLS ensamt räcker, men om någon längre
-- fram lägger till en policy i god tro ska rättigheterna inte redan
-- ligga där och vänta. Rollerna finns bara i Supabase, därför testet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
