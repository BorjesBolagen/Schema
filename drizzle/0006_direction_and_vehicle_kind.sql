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
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."vehicle_kind" AS ENUM('linjebil', 'bytesbil', 'annan');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "transpa_shift" ADD COLUMN IF NOT EXISTS "direction" "direction";
--> statement-breakpoint
ALTER TABLE "board_row" ADD COLUMN IF NOT EXISTS "vehicle_kind" "vehicle_kind" DEFAULT 'annan' NOT NULL;
