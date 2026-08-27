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
