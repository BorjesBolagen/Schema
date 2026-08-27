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
--> statement-breakpoint
ALTER TABLE "transpa_shift" ADD CONSTRAINT "transpa_shift_employee_id_employee_id_fk"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transpa_shift_lookup_idx" ON "transpa_shift" ("employee_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transpa_shift_date_idx" ON "transpa_shift" ("date");
--> statement-breakpoint
ALTER TABLE "transpa_shift" ENABLE ROW LEVEL SECURITY;
