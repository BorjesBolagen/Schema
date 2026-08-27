-- Arbetsmönstren tas bort.
--
-- De fanns som reserv medan det var oklart om TransPA kunde leverera
-- arbetsdagar. Det kan den: /v1/shifts/ ger planerade pass per person,
-- och de synkas till transpa_shift. Två källor att hålla i synk var
-- precis det dubbelarbete verktyget skulle ta bort.

DROP TABLE IF EXISTS "work_pattern_day";
--> statement-breakpoint
DROP TABLE IF EXISTS "work_pattern";
