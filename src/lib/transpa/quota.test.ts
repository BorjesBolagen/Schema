import { beforeEach, describe, expect, it } from "vitest";
import {
  clearQuotaBlock,
  humanDuration,
  noteQuotaExhausted,
  parseReplenish,
  quotaBlockedFor,
} from "./quota";

/**
 * Kvoten tog slut i skarpt läge, och 429:an syntes bara som ett fel
 * bland andra. Det som provas här är att den läses som vad den är: hur
 * länge till, och att följdanropen ställs in.
 */

describe("parseReplenish", () => {
  /* Svaret Johan fick, ordagrant. */
  it("läser TransPA:s egen formulering", () => {
    const ms = parseReplenish(
      "Out of call volume quota. Quota will be replenished in 1.16:10:17. You might want to consider upgrading quota capacity for your subscription",
    );
    expect(ms).toBe(((1 * 24 + 16) * 60 + 10) * 60_000 + 17_000);
  });

  it("klarar formen utan dygn", () => {
    expect(parseReplenish("Quota will be replenished in 00:45:00")).toBe(45 * 60_000);
  });

  it("ger null när texten inte säger något om tid", () => {
    expect(parseReplenish("Too many requests")).toBeNull();
  });
});

describe("humanDuration", () => {
  it("säger dygn och timmar, inte sekunder", () => {
    expect(humanDuration(((1 * 24 + 16) * 60 + 10) * 60_000)).toBe("1 dygn 16 tim");
  });

  it("säger minuter när det rör sig om minuter", () => {
    expect(humanDuration(45 * 60_000)).toBe("45 min");
  });

  it("avrundar inte ned till ingenting", () => {
    expect(humanDuration(20_000)).toBe("mindre än en minut");
  });
});

describe("spärren", () => {
  beforeEach(clearQuotaBlock);

  it("är öppen tills något säger annat", () => {
    expect(quotaBlockedFor()).toBe(0);
  });

  it("stänger till påfyllningen", () => {
    const nu = Date.now();
    noteQuotaExhausted(60 * 60_000);
    expect(quotaBlockedFor(nu + 30 * 60_000)).toBeGreaterThan(0);
    expect(quotaBlockedFor(nu + 61 * 60_000)).toBe(0);
  });

  /* Utan tid i svaret behövs ändå en paus — annars fortsätter samma
     körning rakt in i taket. */
  it("pausar en stund även utan angiven tid", () => {
    noteQuotaExhausted(null);
    expect(quotaBlockedFor()).toBeGreaterThan(0);
  });

  it("förlänger, men förkortar aldrig", () => {
    noteQuotaExhausted(60 * 60_000);
    const långt = quotaBlockedFor();
    noteQuotaExhausted(1000);
    expect(quotaBlockedFor()).toBeGreaterThan(långt - 5_000);
  });
});
