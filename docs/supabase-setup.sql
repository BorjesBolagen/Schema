-- Genererad av scripts/build-setup-sql.ts — redigera inte för hand.
-- Klistra in i Supabase → SQL Editor och kör.
--
-- Går att köra om. Det som redan finns hoppas över, det som fattas
-- läggs på. Kör den alltså i sin helhet även mot en databas som
-- redan är uppsatt — du behöver inte veta hur långt den kommit.
-- Migrationer: 0000_init.sql, 0001_legal_king_cobra.sql, 0002_rls.sql, 0003_profession_group.sql, 0004_transpa_shifts.sql, 0005_drop_work_patterns.sql, 0006_direction_and_vehicle_kind.sql, 0007_shift_ends_at.sql, 0008_rotation.sql

BEGIN;

-- 0000_init.sql
DO $$ BEGIN
  CREATE TYPE "public"."absence_status" AS ENUM('requested', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."absence_type" AS ENUM('semester', 'sjuk', 'vab', 'tjanstledig', 'foraldraledig', 'kompledig', 'ovrig');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."assignment_source" AS ENUM('generated', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."board_role" AS ENUM('editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."row_kind" AS ENUM('resource', 'person');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."shift" AS ENUM('day', 'night');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."user_role" AS ENUM('admin', 'planner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."view_mode" AS ENUM('resource', 'person');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS "absence" (
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
CREATE TABLE IF NOT EXISTS "app_user" (
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
CREATE TABLE IF NOT EXISTS "assignment" (
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
CREATE TABLE IF NOT EXISTS "base_schedule" (
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
CREATE TABLE IF NOT EXISTS "board" (
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
CREATE TABLE IF NOT EXISTS "board_crew" (
	"board_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "board_crew_board_id_employee_id_pk" PRIMARY KEY("board_id","employee_id")
);
CREATE TABLE IF NOT EXISTS "board_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS "board_member" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "board_role" DEFAULT 'editor' NOT NULL,
	CONSTRAINT "board_member_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
CREATE TABLE IF NOT EXISTS "board_row" (
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
CREATE TABLE IF NOT EXISTS "employee" (
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
CREATE TABLE IF NOT EXISTS "session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "station_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	"supervisor_phone_number" text,
	"emergency_phone_number" text,
	CONSTRAINT "station_place_transpa_id_unique" UNIQUE("transpa_id")
);
CREATE TABLE IF NOT EXISTS "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "traffic_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	CONSTRAINT "traffic_area_transpa_id_unique" UNIQUE("transpa_id")
);
CREATE TABLE IF NOT EXISTS "vehicle" (
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
CREATE TABLE IF NOT EXISTS "vehicle_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	CONSTRAINT "vehicle_group_transpa_id_unique" UNIQUE("transpa_id")
);
CREATE TABLE IF NOT EXISTS "work_pattern" (
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
CREATE TABLE IF NOT EXISTS "work_pattern_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_pattern_id" uuid NOT NULL,
	"cycle_week" integer DEFAULT 0 NOT NULL,
	"weekday" integer NOT NULL,
	"shift" "shift" DEFAULT 'day' NOT NULL,
	CONSTRAINT "work_pattern_day_uq" UNIQUE("work_pattern_id","cycle_week","weekday","shift")
);
DO $$ BEGIN
  ALTER TABLE "absence" ADD CONSTRAINT "absence_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "absence" ADD CONSTRAINT "absence_transpa_synced_by_app_user_id_fk" FOREIGN KEY ("transpa_synced_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "assignment" ADD CONSTRAINT "assignment_board_row_id_board_row_id_fk" FOREIGN KEY ("board_row_id") REFERENCES "public"."board_row"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "assignment" ADD CONSTRAINT "assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "assignment" ADD CONSTRAINT "assignment_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "assignment" ADD CONSTRAINT "assignment_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "base_schedule" ADD CONSTRAINT "base_schedule_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "base_schedule" ADD CONSTRAINT "base_schedule_board_row_id_board_row_id_fk" FOREIGN KEY ("board_row_id") REFERENCES "public"."board_row"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "base_schedule" ADD CONSTRAINT "base_schedule_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board" ADD CONSTRAINT "board_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board" ADD CONSTRAINT "board_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_crew" ADD CONSTRAINT "board_crew_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_crew" ADD CONSTRAINT "board_crew_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_group" ADD CONSTRAINT "board_group_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_member" ADD CONSTRAINT "board_member_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_member" ADD CONSTRAINT "board_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_row" ADD CONSTRAINT "board_row_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_row" ADD CONSTRAINT "board_row_group_id_board_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."board_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_row" ADD CONSTRAINT "board_row_default_vehicle_id_vehicle_id_fk" FOREIGN KEY ("default_vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_row" ADD CONSTRAINT "board_row_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "employee" ADD CONSTRAINT "employee_station_place_id_station_place_id_fk" FOREIGN KEY ("station_place_id") REFERENCES "public"."station_place"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "employee" ADD CONSTRAINT "employee_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_station_place_id_station_place_id_fk" FOREIGN KEY ("station_place_id") REFERENCES "public"."station_place"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_vehicle_group_id_vehicle_group_id_fk" FOREIGN KEY ("vehicle_group_id") REFERENCES "public"."vehicle_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "work_pattern" ADD CONSTRAINT "work_pattern_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "work_pattern_day" ADD CONSTRAINT "work_pattern_day_work_pattern_id_work_pattern_id_fk" FOREIGN KEY ("work_pattern_id") REFERENCES "public"."work_pattern"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "absence_employee_range_idx" ON "absence" USING btree ("employee_id","from_date","to_date");
CREATE INDEX IF NOT EXISTS "assignment_employee_date_idx" ON "assignment" USING btree ("employee_id","date");
CREATE INDEX IF NOT EXISTS "assignment_vehicle_date_idx" ON "assignment" USING btree ("vehicle_id","date");
CREATE INDEX IF NOT EXISTS "assignment_date_idx" ON "assignment" USING btree ("date");
CREATE INDEX IF NOT EXISTS "base_schedule_board_idx" ON "base_schedule" USING btree ("board_id");
CREATE INDEX IF NOT EXISTS "base_schedule_employee_idx" ON "base_schedule" USING btree ("employee_id");
CREATE INDEX IF NOT EXISTS "board_group_board_idx" ON "board_group" USING btree ("board_id","sort_order");
CREATE INDEX IF NOT EXISTS "board_row_board_idx" ON "board_row" USING btree ("board_id","sort_order");
CREATE INDEX IF NOT EXISTS "employee_active_idx" ON "employee" USING btree ("is_active");
CREATE INDEX IF NOT EXISTS "employee_station_idx" ON "employee" USING btree ("station_place_id");
CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "work_pattern_employee_idx" ON "work_pattern" USING btree ("employee_id");

-- 0001_legal_king_cobra.sql
CREATE TABLE IF NOT EXISTS "transpa_tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transpa_tenant_tenant_id_unique" UNIQUE("tenant_id")
);
ALTER TABLE "employee" DROP CONSTRAINT IF EXISTS "employee_employee_number_unique";
ALTER TABLE "employee" ADD COLUMN IF NOT EXISTS "transpa_tenant_id" uuid;
DO $$ BEGIN
  ALTER TABLE "employee" ADD CONSTRAINT "employee_transpa_tenant_id_transpa_tenant_id_fk" FOREIGN KEY ("transpa_tenant_id") REFERENCES "public"."transpa_tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "employee_tenant_idx" ON "employee" USING btree ("transpa_tenant_id");
DO $$ BEGIN
  ALTER TABLE "employee" ADD CONSTRAINT "employee_number_uq" UNIQUE("transpa_tenant_id","employee_number");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- 0002_rls.sql
DO $$ BEGIN
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
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "base_schedule" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_crew" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_group" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_member" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "board_row" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "station_place" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "sync_run" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "traffic_area" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "transpa_tenant" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle_group" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "work_pattern" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "work_pattern_day" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
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
DO $$ BEGIN
  ALTER TABLE "transpa_shift" ADD CONSTRAINT "transpa_shift_employee_id_employee_id_fk"
    FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "transpa_shift_lookup_idx" ON "transpa_shift" ("employee_id","date");
CREATE INDEX IF NOT EXISTS "transpa_shift_date_idx" ON "transpa_shift" ("date");
DO $$ BEGIN
  ALTER TABLE "transpa_shift" ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 0005_drop_work_patterns.sql
-- Arbetsmönstren tas bort.
--
-- De fanns som reserv medan det var oklart om TransPA kunde leverera
-- arbetsdagar. Det kan den: /v1/shifts/ ger planerade pass per person,
-- och de synkas till transpa_shift. Två källor att hålla i synk var
-- precis det dubbelarbete verktyget skulle ta bort.

DROP TABLE IF EXISTS "work_pattern_day";
DROP TABLE IF EXISTS "work_pattern";

-- 0006_direction_and_vehicle_kind.sql
-- Riktning på linjepass, och vad slags bil en rad står för.
--
-- En linje körs av två bilar som möts på vägen: den ena går upp medan
-- den andra går ner, och nästa natt byter de. Båda står på samma rad
-- samma natt, så utan riktning går cellen inte att läsa.
--
-- Riktningen tolkas ur TransPA:s benämning på passet ("Vmo-Sto ner"),
-- inte ur något som underhålls här. Null betyder att benämningen inte
-- sade något — inte att passet saknar riktning.
--
-- En bytesbil vänder halvvägs varje kväll och kör hem igen. Där finns
-- ingen upp och ner att hålla isär, och raden ska därför inte visa
-- någon pil. Default är "annan", så befintliga rader beter sig som förut.

DO $$ BEGIN
  CREATE TYPE "public"."direction" AS ENUM('upp', 'ner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."vehicle_kind" AS ENUM('linjebil', 'bytesbil', 'annan');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "transpa_shift" ADD COLUMN IF NOT EXISTS "direction" "direction";
ALTER TABLE "board_row" ADD COLUMN IF NOT EXISTS "vehicle_kind" "vehicle_kind" DEFAULT 'annan' NOT NULL;

-- 0007_shift_ends_at.sql
-- Passets sluttid, sparad som den kommer.
--
-- transpa_shift.date och .shift är härledda värden, räknade vid
-- hämtningen. Ändras regeln som härleder dem blir varje redan sparad
-- rad tyst fel — och det hände: nattpass fortsatte visas som dagpass
-- efter att regeln rättats, ända tills någon råkade hämta om veckan.
--
-- Med sluttiden sparad kan tolkningen göras om vid läsning i stället.
-- date och shift blir då en cache och ett grovt index att filtrera
-- veckan på, inte sanningen.
--
-- Null betyder att TransPA inte uppgav någon sluttid för passet.

ALTER TABLE "transpa_shift" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;

-- 0008_rotation.sql
-- Rullande scheman.
--
-- Bas-schemat sade bara *vilken bil* en person hör till, och det räcker
-- för den som kör samma bil varje dag. Den som kör olika bilar olika
-- dagar, eller olika bilar olika veckor i en rotation, kunde inte
-- skrivas ned alls.
--
-- Cykeln hör till tavlan: i Värnamo delar hela tavlan samma
-- vecka→pass-tabell, precis som i Excel. Längd 1 betyder ingen
-- rotation, vilket är förvalet, så befintliga tavlor är oförändrade.
--
-- cycle_weeks och weekdays är nullbara. Tomt betyder alltid, inte
-- aldrig — en koppling utan angivna dagar är en stående koppling.

ALTER TABLE "board" ADD COLUMN IF NOT EXISTS "cycle_length" integer DEFAULT 1 NOT NULL;
ALTER TABLE "board" ADD COLUMN IF NOT EXISTS "cycle_offset" integer DEFAULT 0 NOT NULL;
ALTER TABLE "base_schedule" ADD COLUMN IF NOT EXISTS "cycle_weeks" integer[];
ALTER TABLE "base_schedule" ADD COLUMN IF NOT EXISTS "weekdays" integer[];

-- Markera migrationerna som körda, så npm run db:migrate inte
-- försöker köra dem igen mot samma databas.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT 'da85dbf7fb69b7a7c1661b40b2e12a22281c5b872083f8fc0860a7d092574a0a', 1787314083994
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'da85dbf7fb69b7a7c1661b40b2e12a22281c5b872083f8fc0860a7d092574a0a');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '4e6645446d4594454fd301bf28b7d1cfc1cb9b244ef064e00694b465cd6b9900', 1787657708770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '4e6645446d4594454fd301bf28b7d1cfc1cb9b244ef064e00694b465cd6b9900');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '0a7dfb80a764393a76f6357a11100efaff85d2e2033aa9b1b01755e5845d0621', 1787657709770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '0a7dfb80a764393a76f6357a11100efaff85d2e2033aa9b1b01755e5845d0621');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT 'e9763d9ebc8edf8b80d54a3d2f65281e4bbed7a6df90043d08c74e7d06c15097', 1787657710770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'e9763d9ebc8edf8b80d54a3d2f65281e4bbed7a6df90043d08c74e7d06c15097');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '20f00cb6314bef4beef9e9bac2689c0da1edd2e7b8913e54b2a9f81b6cd882d3', 1787657711770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '20f00cb6314bef4beef9e9bac2689c0da1edd2e7b8913e54b2a9f81b6cd882d3');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '88f5f5c1f3dd0396bf5c5272c4917a4e6fcc85f28a0cbafe5efea212ff0a179b', 1787657712770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '88f5f5c1f3dd0396bf5c5272c4917a4e6fcc85f28a0cbafe5efea212ff0a179b');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '8463a4f4b8ef2d906fe8b37777ddbb9c5c25e4e6133fcd72d699527d0486d5fc', 1787657713770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '8463a4f4b8ef2d906fe8b37777ddbb9c5c25e4e6133fcd72d699527d0486d5fc');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT 'ec4bfd13f9d121540fcbac335e5bf33ced0e7b1df380826312815f2011c1638c', 1787657714770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'ec4bfd13f9d121540fcbac335e5bf33ced0e7b1df380826312815f2011c1638c');
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) SELECT '9f401390fb2ef8e8f98e21aa79d8add57ea90d1d6c0b09105876c00650f43bf6', 1787657715770
WHERE NOT EXISTS (SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '9f401390fb2ef8e8f98e21aa79d8add57ea90d1d6c0b09105876c00650f43bf6');

COMMIT;
