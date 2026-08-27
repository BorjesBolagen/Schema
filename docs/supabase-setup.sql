-- Genererad av scripts/build-setup-sql.ts — redigera inte för hand.
-- Klistra in i Supabase → SQL Editor och kör.
-- Migrationer: 0000_init.sql, 0001_legal_king_cobra.sql, 0002_rls.sql, 0003_profession_group.sql, 0004_transpa_shifts.sql

BEGIN;

-- 0000_init.sql
CREATE TYPE "public"."absence_status" AS ENUM('requested', 'approved');
CREATE TYPE "public"."absence_type" AS ENUM('semester', 'sjuk', 'vab', 'tjanstledig', 'foraldraledig', 'kompledig', 'ovrig');
CREATE TYPE "public"."assignment_source" AS ENUM('generated', 'manual');
CREATE TYPE "public"."board_role" AS ENUM('editor', 'viewer');
CREATE TYPE "public"."row_kind" AS ENUM('resource', 'person');
CREATE TYPE "public"."shift" AS ENUM('day', 'night');
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'failed');
CREATE TYPE "public"."user_role" AS ENUM('admin', 'planner');
CREATE TYPE "public"."view_mode" AS ENUM('resource', 'person');
CREATE TABLE "absence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"type" "absence_type" DEFAULT 'semester' NOT NULL,
	"status" "absence_status" DEFAULT 'approved' NOT NULL,
	"note" text,
	"transpa_synced_at" timestamp with time zone,
	"transpa_synced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'planner' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"connect_user_id" text,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email"),
	CONSTRAINT "app_user_connect_user_id_unique" UNIQUE("connect_user_id")
);

CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_row_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift" "shift" DEFAULT 'day' NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	"employee_id" uuid,
	"vehicle_id" uuid,
	"note" text,
	"source" "assignment_source" DEFAULT 'manual' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_cell_uq" UNIQUE("board_row_id","date","shift","slot")
);

CREATE TABLE "base_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"board_row_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift" "shift" DEFAULT 'day' NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"traffic_area_id" uuid,
	"owner_id" uuid,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"visible_weekdays" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"visible_shifts" text[] DEFAULT '{"day"}' NOT NULL,
	"default_view_mode" "view_mode" DEFAULT 'resource' NOT NULL,
	"cell_fields" text[] DEFAULT '{"driver","vehicle"}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_slug_unique" UNIQUE("slug")
);

CREATE TABLE "board_crew" (
	"board_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "board_crew_board_id_employee_id_pk" PRIMARY KEY("board_id","employee_id")
);

CREATE TABLE "board_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "board_member" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "board_role" DEFAULT 'editor' NOT NULL,
	CONSTRAINT "board_member_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);

CREATE TABLE "board_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"group_id" uuid,
	"label" text NOT NULL,
	"sublabel" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"kind" "row_kind" DEFAULT 'resource' NOT NULL,
	"default_vehicle_id" uuid,
	"employee_id" uuid,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"employee_number" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"signature" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"station_place_id" uuid,
	"traffic_area_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_transpa_id_unique" UNIQUE("transpa_id"),
	CONSTRAINT "employee_employee_number_unique" UNIQUE("employee_number")
);

CREATE TABLE "session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "station_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	"supervisor_phone_number" text,
	"emergency_phone_number" text,
	CONSTRAINT "station_place_transpa_id_unique" UNIQUE("transpa_id")
);

CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);

CREATE TABLE "traffic_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	CONSTRAINT "traffic_area_transpa_id_unique" UNIQUE("transpa_id")
);

CREATE TABLE "vehicle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"registration_number" text,
	"external_id" text,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"traffic_area_id" uuid,
	"station_place_id" uuid,
	"vehicle_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_transpa_id_unique" UNIQUE("transpa_id")
);

CREATE TABLE "vehicle_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	CONSTRAINT "vehicle_group_transpa_id_unique" UNIQUE("transpa_id")
);

CREATE TABLE "work_pattern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"cycle_weeks" integer DEFAULT 1 NOT NULL,
	"anchor_date" date NOT NULL,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "work_pattern_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_pattern_id" uuid NOT NULL,
	"cycle_week" integer DEFAULT 0 NOT NULL,
	"weekday" integer NOT NULL,
	"shift" "shift" DEFAULT 'day' NOT NULL,
	CONSTRAINT "work_pattern_day_uq" UNIQUE("work_pattern_id","cycle_week","weekday","shift")
);

ALTER TABLE "absence" ADD CONSTRAINT "absence_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "absence" ADD CONSTRAINT "absence_transpa_synced_by_app_user_id_fk" FOREIGN KEY ("transpa_synced_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_board_row_id_board_row_id_fk" FOREIGN KEY ("board_row_id") REFERENCES "public"."board_row"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "base_schedule" ADD CONSTRAINT "base_schedule_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "base_schedule" ADD CONSTRAINT "base_schedule_board_row_id_board_row_id_fk" FOREIGN KEY ("board_row_id") REFERENCES "public"."board_row"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "base_schedule" ADD CONSTRAINT "base_schedule_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board" ADD CONSTRAINT "board_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "board" ADD CONSTRAINT "board_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "board_crew" ADD CONSTRAINT "board_crew_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_crew" ADD CONSTRAINT "board_crew_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_group" ADD CONSTRAINT "board_group_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_group_id_board_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."board_group"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_default_vehicle_id_vehicle_id_fk" FOREIGN KEY ("default_vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employee" ADD CONSTRAINT "employee_station_place_id_station_place_id_fk" FOREIGN KEY ("station_place_id") REFERENCES "public"."station_place"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employee" ADD CONSTRAINT "employee_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_station_place_id_station_place_id_fk" FOREIGN KEY ("station_place_id") REFERENCES "public"."station_place"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_vehicle_group_id_vehicle_group_id_fk" FOREIGN KEY ("vehicle_group_id") REFERENCES "public"."vehicle_group"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "work_pattern" ADD CONSTRAINT "work_pattern_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "work_pattern_day" ADD CONSTRAINT "work_pattern_day_work_pattern_id_work_pattern_id_fk" FOREIGN KEY ("work_pattern_id") REFERENCES "public"."work_pattern"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "absence_employee_range_idx" ON "absence" USING btree ("employee_id","from_date","to_date");
CREATE INDEX "assignment_employee_date_idx" ON "assignment" USING btree ("employee_id","date");
CREATE INDEX "assignment_vehicle_date_idx" ON "assignment" USING btree ("vehicle_id","date");
CREATE INDEX "assignment_date_idx" ON "assignment" USING btree ("date");
CREATE INDEX "base_schedule_board_idx" ON "base_schedule" USING btree ("board_id");
CREATE INDEX "base_schedule_employee_idx" ON "base_schedule" USING btree ("employee_id");
CREATE INDEX "board_group_board_idx" ON "board_group" USING btree ("board_id","sort_order");
CREATE INDEX "board_row_board_idx" ON "board_row" USING btree ("board_id","sort_order");
CREATE INDEX "employee_active_idx" ON "employee" USING btree ("is_active");
CREATE INDEX "employee_station_idx" ON "employee" USING btree ("station_place_id");
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");
CREATE INDEX "work_pattern_employee_idx" ON "work_pattern" USING btree ("employee_id");

-- 0001_legal_king_cobra.sql
CREATE TABLE "transpa_tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transpa_tenant_tenant_id_unique" UNIQUE("tenant_id")
);

ALTER TABLE "employee" DROP CONSTRAINT "employee_employee_number_unique";
ALTER TABLE "employee" ADD COLUMN "transpa_tenant_id" uuid;
ALTER TABLE "employee" ADD CONSTRAINT "employee_transpa_tenant_id_transpa_tenant_id_fk" FOREIGN KEY ("transpa_tenant_id") REFERENCES "public"."transpa_tenant"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "employee_tenant_idx" ON "employee" USING btree ("transpa_tenant_id");
ALTER TABLE "employee" ADD CONSTRAINT "employee_number_uq" UNIQUE("transpa_tenant_id","employee_number");

-- 0002_rls.sql
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

-- 0003_profession_group.sql
-- Yrkesroll från TransPA.
--
-- Körningen mot Börjes tenant 2026-08-26: 281 chaufförer, 18 "other"
-- och 2 "garage" av 301 personer. Fältet finns för att de tjugo som
-- inte kör ska gå att sortera bort när ett schema läggs — inte för att
-- det säger något om var någon är stationerad. Det gör det inte:
-- varken professionGroup eller grouping bär ort, och grouping är tomt
-- för samtliga.

ALTER TABLE "employee" ADD COLUMN IF NOT EXISTS "profession_group" text;

-- 0004_transpa_shifts.sql
-- Pass hämtade från TransPA.
--
-- Egen tabell av samma skäl som personal och stationsorter har det:
-- tavelvyn ligger bakom en databastidsgräns, och ett nätanrop i
-- renderingsvägen fällde hela sidan när TransPA gick trögt. Passen
-- hämtas i synken och läses härifrån.
--
-- date och shift räknas fram vid synken, i svensk lokaltid: ett pass som
-- startar 22:30Z en måndag i augusti är tisdag 00:30 här, alltså fel dag
-- och fel skift om tidpunkten läses rakt av vid varje läsning.

CREATE TABLE IF NOT EXISTS "transpa_shift" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "transpa_id" text NOT NULL,
  "employee_id" uuid NOT NULL,
  "date" date NOT NULL,
  "shift" "shift" DEFAULT 'day' NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "work_minutes" integer,
  "is_extra_shift" boolean DEFAULT false NOT NULL,
  "name" text,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "transpa_shift_transpa_id_unique" UNIQUE("transpa_id")
);

ALTER TABLE "transpa_shift" ADD CONSTRAINT "transpa_shift_employee_id_employee_id_fk"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade;

CREATE INDEX IF NOT EXISTS "transpa_shift_lookup_idx" ON "transpa_shift" ("employee_id","date");

CREATE INDEX IF NOT EXISTS "transpa_shift_date_idx" ON "transpa_shift" ("date");

ALTER TABLE "transpa_shift" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Markera migrationerna som körda, så npm run db:migrate inte
-- försöker köra dem igen mot samma databas.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT 'dcd5e93674f810457deb29590251f149eefcf063f76dcadaff83beeec8b6cee6', 1787314083994
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'dcd5e93674f810457deb29590251f149eefcf063f76dcadaff83beeec8b6cee6');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '630566f1c775d7cab27a27d2f34809d526f59edc848077f6b812b4f881b20934', 1787657708770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '630566f1c775d7cab27a27d2f34809d526f59edc848077f6b812b4f881b20934');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT 'f4da4f11a725385615862e445dc258a6ea655516dbbe074d071ee95b74ce6e07', 1787657709770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'f4da4f11a725385615862e445dc258a6ea655516dbbe074d071ee95b74ce6e07');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT 'e9763d9ebc8edf8b80d54a3d2f65281e4bbed7a6df90043d08c74e7d06c15097', 1787657710770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'e9763d9ebc8edf8b80d54a3d2f65281e4bbed7a6df90043d08c74e7d06c15097');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '561712ebc5d19e753753246dfcc89deef1ec5103edaff0b8055ba62fa9b9828f', 1787657711770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '561712ebc5d19e753753246dfcc89deef1ec5103edaff0b8055ba62fa9b9828f');