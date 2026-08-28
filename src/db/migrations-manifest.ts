/**
 * Migrationerna, som en modul.
 *
 * GENERERAD av scripts/build-setup-sql.ts — redigera inte för hand.
 *
 * Finns för att appen ska kunna säga *vilken* migration som fattas
 * när databasen ligger efter koden. Drizzle-katalogen finns inte i
 * en byggd app, så uppgifterna måste bakas in.
 */

export interface MigrationRef {
  tag: string;
  hash: string;
}

export const MIGRATIONS: MigrationRef[] = [
  { tag: "0000_init", hash: "da85dbf7fb69b7a7c1661b40b2e12a22281c5b872083f8fc0860a7d092574a0a" },
  { tag: "0001_legal_king_cobra", hash: "4e6645446d4594454fd301bf28b7d1cfc1cb9b244ef064e00694b465cd6b9900" },
  { tag: "0002_rls", hash: "0a7dfb80a764393a76f6357a11100efaff85d2e2033aa9b1b01755e5845d0621" },
  { tag: "0003_profession_group", hash: "e9763d9ebc8edf8b80d54a3d2f65281e4bbed7a6df90043d08c74e7d06c15097" },
  { tag: "0004_transpa_shifts", hash: "20f00cb6314bef4beef9e9bac2689c0da1edd2e7b8913e54b2a9f81b6cd882d3" },
  { tag: "0005_drop_work_patterns", hash: "88f5f5c1f3dd0396bf5c5272c4917a4e6fcc85f28a0cbafe5efea212ff0a179b" },
  { tag: "0006_direction_and_vehicle_kind", hash: "8463a4f4b8ef2d906fe8b37777ddbb9c5c25e4e6133fcd72d699527d0486d5fc" },
  { tag: "0007_shift_ends_at", hash: "ec4bfd13f9d121540fcbac335e5bf33ced0e7b1df380826312815f2011c1638c" },
  { tag: "0008_rotation", hash: "9f401390fb2ef8e8f98e21aa79d8add57ea90d1d6c0b09105876c00650f43bf6" },
];
