import { describe, expect, it } from "vitest";
import { parseDirection } from "./direction";

/**
 * Benämningarna nedan är riktiga, hämtade ur tenanten för en
 * nattchaufför på Värnamo–Stockholm 17–28 augusti 2026. Formen varierar
 * — riktningen står först, sist eller mitt i, med eller utan versal —
 * så tolkningen får inte bygga på att den ligger på en viss plats.
 */
describe("parseDirection", () => {
  it("läser riktningen ur verkliga benämningar", () => {
    expect(parseDirection("16.00-03.00, Vmo-Sto ner")).toBe("ner");
    expect(parseDirection("Vmo-Sto upp 19.00")).toBe("upp");
    expect(parseDirection("Vmo-Sthlm Upp")).toBe("upp");
  });

  it("bryr sig inte om versaler", () => {
    expect(parseDirection("VMO-STO NER")).toBe("ner");
    expect(parseDirection("Ner till Värnamo")).toBe("ner");
  });

  /* Uppsala är en ort man kan köra till, och innehåller "upp". En
     delsträngsmatchning hade kallat varje Uppsalatur för en upptur. */
  it("tar inte ortnamn för riktningar", () => {
    expect(parseDirection("Vmo-Uppsala")).toBeNull();
    expect(parseDirection("Uppsala natt")).toBeNull();
    expect(parseDirection("Upplands Väsby")).toBeNull();
  });

  it("läser riktningen även när ortnamnet också innehåller den", () => {
    expect(parseDirection("Vmo-Uppsala upp")).toBe("upp");
    expect(parseDirection("Uppsala ner 18.00")).toBe("ner");
  });

  /* Säger benämningen emot sig själv är null ärligare än att välja. */
  it("ger null när båda orden står i samma benämning", () => {
    expect(parseDirection("upp och ner")).toBeNull();
  });

  it("ger null när riktningen inte står där", () => {
    expect(parseDirection("Vmo-Sto")).toBeNull();
    expect(parseDirection("Nattpass")).toBeNull();
    expect(parseDirection("")).toBeNull();
    expect(parseDirection(null)).toBeNull();
    expect(parseDirection(undefined)).toBeNull();
  });

  it("klarar skiljetecken runt ordet", () => {
    expect(parseDirection("Vmo-Sto, ner")).toBe("ner");
    expect(parseDirection("(upp)")).toBe("upp");
    expect(parseDirection("Sto/upp")).toBe("upp");
  });
});
