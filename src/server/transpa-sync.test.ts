import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { READ_SCOPES } from "@/lib/transpa/auth";

/**
 * Synken hämtar bara det Börjes faktiskt fått scope för.
 *
 * Listan nedan är den Visma beviljade (2026-08-24). Testet finns för att
 * fånga att koden och verkligheten glider isär: begär synken något som
 * inte är beviljat blir det 403 vid varje körning, och begärs ett scope
 * som inte finns kan hela token-hämtningen nekas.
 */
const GRANTED = [
  "transpaapi:api",
  "transpaapi:employees:read",
  "transpaapi:shifts:read",
  "transpaapi:stationplaces:read",
  "transpaapi:trips:read",
  "transpaapi:vehicles:read",
  "transpaapi:workgroups:read",
  "transpaapi:worktasks:read",
];

describe("TransPA-scopes", () => {
  it("begär bara scopes som är beviljade", () => {
    const extra = READ_SCOPES.filter((s) => !GRANTED.includes(s));
    expect(extra).toEqual([]);
  });

  it("begär inga skrivscopes — appen skriver inget till TransPA än", () => {
    expect(READ_SCOPES.filter((s) => s.endsWith(":write"))).toEqual([]);
  });

  it("saknar trafficareas och vehiclegroups, som aldrig beviljades", () => {
    expect(READ_SCOPES).not.toContain("transpaapi:trafficareas:read");
    expect(READ_SCOPES).not.toContain("transpaapi:vehiclegroups:read");
  });
});

/**
 * TransPA:s Employee bär mer än vi vill ha.
 *
 * Körningen 2026-08-26 visade att /v1/employees returnerar
 * nationalIdentityNumber, address och tachographCards — personnummer,
 * hemadress och förarkortnummer. Inget av det behövs för att lägga ett
 * schema, och därför ska inget av det lagras. Testet finns för att den
 * gränsen är lätt att råka flytta: fälten kommer i svaret, och att
 * mappa in ett till är en rad kod.
 */
const FORBIDDEN = [
  "nationalIdentityNumber",
  "address",
  "tachographCards",
  "loginEmail",
  "loginPhoneNumber",
];

describe("personuppgifter i synken", () => {
  it("mappar aldrig in personnummer, adress eller förarkort", async () => {
    const source = await readFile(new URL("./transpa-sync.ts", import.meta.url), "utf8");
    const found = FORBIDDEN.filter((field) => source.includes(field));
    expect(found).toEqual([]);
  });

  it("lagrar inte heller fälten i databasmodellen", async () => {
    const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
    const found = FORBIDDEN.filter((field) => source.includes(field));
    expect(found).toEqual([]);
  });
});
