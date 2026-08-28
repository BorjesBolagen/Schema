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
--> statement-breakpoint
ALTER TABLE "board" ADD COLUMN IF NOT EXISTS "cycle_offset" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "base_schedule" ADD COLUMN IF NOT EXISTS "cycle_weeks" integer[];
--> statement-breakpoint
ALTER TABLE "base_schedule" ADD COLUMN IF NOT EXISTS "weekdays" integer[];
