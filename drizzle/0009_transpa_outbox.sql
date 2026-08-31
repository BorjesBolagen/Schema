-- Spår av varje skrivning till TransPA.
--
-- Tenanten är Börjes produktionsmiljö. En ändring där påverkar en
-- riktig chaufförs arbetsdag, och den som undrar varför ett pass
-- flyttades ska kunna få veta vem som tryckte, när, och vad som
-- skickades — utan att leta i en serverlogg som ändå rullat förbi.
--
-- Raden skrivs även när anropet misslyckas. Ett misslyckat försök är
-- också något som hände.

DO $$ BEGIN
  CREATE TYPE "public"."outbox_status" AS ENUM('ok', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transpa_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "employee_id" uuid,
  "transpa_shift_id" text,
  "summary" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "request_body" text,
  "status" "outbox_status" NOT NULL,
  "response_status" integer,
  "response_body" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "transpa_outbox" ADD CONSTRAINT "transpa_outbox_user_id_app_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "transpa_outbox" ADD CONSTRAINT "transpa_outbox_employee_id_employee_id_fk"
    FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transpa_outbox_created_idx" ON "transpa_outbox" ("created_at");
--> statement-breakpoint
ALTER TABLE "transpa_outbox" ENABLE ROW LEVEL SECURITY;
