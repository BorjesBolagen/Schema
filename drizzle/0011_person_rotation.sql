-- Rotationen flyttar från tavlan till kopplingen, och skiftet försvinner
-- ur bas-schemat.
--
-- Två fel som visade sig i verkligheten.
--
-- Kopplingen bar ett skift, dag eller natt. Men den som kör fyra
-- nattpass vecka 1 och 2, ett nattpass och två dagpass vecka 3, och tre
-- dagpass vecka 4 går inte att skriva så: vecka 3 är personen kopplad
-- till samma bil på båda skiften. Skiftet ska inte stå i kopplingen
-- alls — passets tider i TransPA vet redan om det är dag eller natt.
--
-- Cykellängden låg på tavlan. Men rotationer hör till personer: en kan
-- gå i en fyraveckorscykel på en bil och varannan vecka på en annan,
-- medan kollegan på samma tavla kör varje vecka. En längd per tavla
-- gjorde det omöjligt att skriva ned.

ALTER TABLE "base_schedule" ADD COLUMN IF NOT EXISTS "cycle_length" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "base_schedule" ADD COLUMN IF NOT EXISTS "cycle_offset" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Ärv tavlans cykel, så befintliga kopplingar betyder samma sak efteråt.
UPDATE "base_schedule" b
   SET "cycle_length" = t."cycle_length",
       "cycle_offset" = t."cycle_offset"
  FROM "board" t
 WHERE t."id" = b."board_id";
--> statement-breakpoint
-- Utan skiftet blir två kopplingar som bara skilde sig på dag/natt
-- identiska. Den med lägst sortOrder får stå kvar.
DELETE FROM "base_schedule" a
 USING "base_schedule" b
 WHERE a."board_row_id" = b."board_row_id"
   AND a."employee_id" = b."employee_id"
   AND a."cycle_weeks" IS NOT DISTINCT FROM b."cycle_weeks"
   AND a."weekdays" IS NOT DISTINCT FROM b."weekdays"
   AND a."valid_from" IS NOT DISTINCT FROM b."valid_from"
   AND a."valid_to" IS NOT DISTINCT FROM b."valid_to"
   AND (a."sort_order", a."id") > (b."sort_order", b."id");
--> statement-breakpoint
ALTER TABLE "base_schedule" DROP COLUMN IF EXISTS "shift";
--> statement-breakpoint
-- Tavlans cykel har inget kvar att styra. Två källor till samma sanning
-- var det som gjorde felet möjligt.
ALTER TABLE "board" DROP COLUMN IF EXISTS "cycle_length";
--> statement-breakpoint
ALTER TABLE "board" DROP COLUMN IF EXISTS "cycle_offset";
