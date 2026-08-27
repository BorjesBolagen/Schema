import { describe, expect, it, vi } from "vitest";
import { TranspaShiftProvider, withBudget } from "./shift-provider";

/**
 * Tavelvyn ligger bakom en databastidsgräns på sex sekunder, och den
 * här hämtningen körs inuti den. När passhämtningen lades först i
 * kedjan föll hela sidan med "Databasanropet svarade inte inom 6
 * sekunder" — ett fel som pekar på fel sak och som dessutom pensionerar
 * en databasanslutning som var oskyldig.
 *
 * Testerna kör mot providerns tidsgräns direkt, utan databas: det som
 * ska bevisas är att en trög eller trasig TransPA aldrig kan bli
 * sidans problem.
 */
describe("TranspaShiftProvider", () => {
  it("frågar ingenting när ingen person efterfrågas", async () => {
    const fetchImpl = vi.fn();
    const result = await new TranspaShiftProvider(fetchImpl as unknown as typeof fetch).getWorkDays(
      [],
      "2026-08-17",
      "2026-08-21",
    );

    expect(result).toEqual({ workDays: [], covered: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /* En källa som kastar skulle fälla hela veckan. Den ska i stället
     lämna personerna otäckta så mönstren tar över. */
  it("ger otäckt i stället för att kasta när något går fel", async () => {
    const trasig = (() => Promise.reject(new Error("nätet nere"))) as unknown as typeof fetch;
    const result = await new TranspaShiftProvider(trasig).getWorkDays(
      ["e1"],
      "2026-08-17",
      "2026-08-21",
    );

    expect(result.workDays).toEqual([]);
    expect(result.covered).toEqual([]);
  });

});

/**
 * Tidsgränsen prövas för sig. Genom providern skulle den bli falskt
 * grön: databasuppslaget kommer före nätanropet, och ett fel där
 * avslutar på ett par millisekunder utan att gränsen ens hunnit prövas.
 */
describe("withBudget", () => {
  it("släpper igenom ett svar som hinner", async () => {
    await expect(withBudget(async () => "klart", 500)).resolves.toBe("klart");
  });

  it("ger upp när svaret aldrig kommer", async () => {
    const started = Date.now();
    await expect(withBudget(() => new Promise(() => {}), 50)).rejects.toThrowError(/50 ms/);

    // Med god marginal under tavelvyns sex sekunder.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  /* Utan avbrottet lever anropet vidare och håller uttaget öppet även
     sedan vi slutat vänta på det. */
  it("avbryter det som pågår", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      withBudget((s) => {
        signal = s;
        return new Promise(() => {});
      }, 30),
    ).rejects.toThrow();

    expect(signal?.aborted).toBe(true);
  });

  it("låter ett eget fel gå igenom oförändrat", async () => {
    await expect(
      withBudget(async () => {
        throw new Error("nätet nere");
      }, 500),
    ).rejects.toThrowError("nätet nere");
  });
});
