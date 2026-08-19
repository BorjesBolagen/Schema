CREATE TYPE "public"."absence_status" AS ENUM('requested', 'approved');--> statement-breakpoint
CREATE TYPE "public"."absence_type" AS ENUM('semester', 'sjuk', 'vab', 'tjanstledig', 'foraldraledig', 'kompledig', 'ovrig');--> statement-breakpoint
CREATE TYPE "public"."alias_source" AS ENUM('excel', 'manual', 'transpa');--> statement-breakpoint
CREATE TYPE "public"."board_role" AS ENUM('editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."row_kind" AS ENUM('resource', 'person');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'planner');--> statement-breakpoint
CREATE TYPE "public"."view_mode" AS ENUM('resource', 'person');--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'planner' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_row_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	"employee_id" uuid,
	"vehicle_id" uuid,
	"start_time" time,
	"end_time" time,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_cell_uq" UNIQUE("board_row_id","date","slot")
);
--> statement-breakpoint
CREATE TABLE "board" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"traffic_area_id" uuid,
	"owner_id" uuid,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"visible_weekdays" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"default_view_mode" "view_mode" DEFAULT 'resource' NOT NULL,
	"cell_fields" text[] DEFAULT '{"driver","vehicle"}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "board_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_member" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "board_role" DEFAULT 'editor' NOT NULL,
	CONSTRAINT "board_member_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"employee_number" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"signature" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"traffic_area_text" text,
	"station_place_text" text,
	"vacation_group" text,
	"work_group" text,
	"supervisor" text,
	"email" text,
	"phone" text,
	"traffic_area_id" uuid,
	"station_place_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_transpa_id_unique" UNIQUE("transpa_id"),
	CONSTRAINT "employee_employee_number_unique" UNIQUE("employee_number")
);
--> statement-breakpoint
CREATE TABLE "employee_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"board_id" uuid,
	"source" "alias_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_alias_scope_uq" UNIQUE("alias_normalized","board_id")
);
--> statement-breakpoint
CREATE TABLE "station_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	"supervisor_phone_number" text,
	"emergency_phone_number" text,
	CONSTRAINT "station_place_transpa_id_unique" UNIQUE("transpa_id")
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "traffic_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	CONSTRAINT "traffic_area_transpa_id_unique" UNIQUE("transpa_id")
);
--> statement-breakpoint
CREATE TABLE "unresolved_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"board_id" uuid,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"sample_date" date,
	"resolved_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unresolved_alias_uq" UNIQUE("alias_normalized","board_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "vehicle_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transpa_id" text,
	"name" text NOT NULL,
	CONSTRAINT "vehicle_group_transpa_id_unique" UNIQUE("transpa_id")
);
--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_transpa_synced_by_app_user_id_fk" FOREIGN KEY ("transpa_synced_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_board_row_id_board_row_id_fk" FOREIGN KEY ("board_row_id") REFERENCES "public"."board_row"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_group" ADD CONSTRAINT "board_group_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_group_id_board_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."board_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_default_vehicle_id_vehicle_id_fk" FOREIGN KEY ("default_vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_row" ADD CONSTRAINT "board_row_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_station_place_id_station_place_id_fk" FOREIGN KEY ("station_place_id") REFERENCES "public"."station_place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_alias" ADD CONSTRAINT "employee_alias_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_alias" ADD CONSTRAINT "employee_alias_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_alias" ADD CONSTRAINT "unresolved_alias_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_alias" ADD CONSTRAINT "unresolved_alias_resolved_employee_id_employee_id_fk" FOREIGN KEY ("resolved_employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_traffic_area_id_traffic_area_id_fk" FOREIGN KEY ("traffic_area_id") REFERENCES "public"."traffic_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_station_place_id_station_place_id_fk" FOREIGN KEY ("station_place_id") REFERENCES "public"."station_place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_vehicle_group_id_vehicle_group_id_fk" FOREIGN KEY ("vehicle_group_id") REFERENCES "public"."vehicle_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_employee_range_idx" ON "absence" USING btree ("employee_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "assignment_employee_date_idx" ON "assignment" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "assignment_vehicle_date_idx" ON "assignment" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE INDEX "assignment_date_idx" ON "assignment" USING btree ("date");--> statement-breakpoint
CREATE INDEX "board_group_board_idx" ON "board_group" USING btree ("board_id","sort_order");--> statement-breakpoint
CREATE INDEX "board_row_board_idx" ON "board_row" USING btree ("board_id","sort_order");--> statement-breakpoint
CREATE INDEX "employee_active_idx" ON "employee" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "employee_alias_employee_idx" ON "employee_alias" USING btree ("employee_id");