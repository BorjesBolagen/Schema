-- Märket som säger vilken app databasen tillhör.
--
-- Uppsättningsfilen klistras in för hand i Supabases SQL-editor, och
-- ingenting i den vyn säger vilket projekt man råkar ha framme.
-- Klistras den i fel projekt skapas tjugo tabeller där de inte hör
-- hemma, och felet upptäcks först när någon undrar varför.
--
-- Filen kontrollerar det här märket innan den gör något. Tabellen måste
-- därför skapas här, i en migration, så den finns för nästa körning.

CREATE TABLE IF NOT EXISTS "schema_app_identity" (
  "app" text PRIMARY KEY NOT NULL,
  "installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "schema_app_identity" ("app") VALUES ('borjes-schema')
  ON CONFLICT ("app") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "schema_app_identity" ENABLE ROW LEVEL SECURITY;
