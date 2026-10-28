import { describe, expect, it } from "vitest";
import { isFridayEveningInSweden } from "./cron-window";

describe("isFridayEveningInSweden", () => {
  it("släpper igenom 20 UTC på sommartid", () => {
    expect(isFridayEveningInSweden(new Date("2026-06-05T20:00:00Z"))).toBe(true);
    expect(isFridayEveningInSweden(new Date("2026-06-05T21:00:00Z"))).toBe(false);
  });

  it("släpper igenom 21 UTC på vintertid", () => {
    expect(isFridayEveningInSweden(new Date("2026-11-06T21:00:00Z"))).toBe(true);
    expect(isFridayEveningInSweden(new Date("2026-11-06T20:00:00Z"))).toBe(false);
  });

  it("räknar en sen start inom timmen", () => {
    expect(isFridayEveningInSweden(new Date("2026-11-06T21:47:00Z"))).toBe(true);
  });

  it("stoppar andra dagar", () => {
    expect(isFridayEveningInSweden(new Date("2026-11-05T21:00:00Z"))).toBe(false);
  });
});
