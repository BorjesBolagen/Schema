import { describe, expect, it } from "vitest";
import { looksLikeTranspa, scopeFromDenial, specUrlsFrom } from "./transpa-probe";

/**
 * Att gissa spec-adressen gav tio 404 och slutsatsen "specen finns
 * inte" — vilket var fel. Swagger-UI-sidan bär adressen till sin egen
 * spec, så den läses ur i stället. De här formerna är dem Swagger UI
 * faktiskt skriver.
 */
const BASE = "https://api.mytranspa.com/doc/openapi/swaggerui/";

describe("specUrlsFrom", () => {
  it("löser en relativ url mot sidans katalog", () => {
    const html = `<script>SwaggerUIBundle({ url: "./openapi.json", dom_id: "#ui" })</script>`;
    expect(specUrlsFrom(html, BASE)).toContain(
      "https://api.mytranspa.com/doc/openapi/swaggerui/openapi.json",
    );
  });

  it("löser en url en nivå upp", () => {
    const html = `SwaggerUIBundle({ url: "../openapi.json" })`;
    expect(specUrlsFrom(html, BASE)).toContain(
      "https://api.mytranspa.com/doc/openapi/openapi.json",
    );
  });

  it("löser en rotrelativ url mot värden", () => {
    const html = `SwaggerUIBundle({ url: "/doc/openapi/v1/openapi.json" })`;
    expect(specUrlsFrom(html, BASE)).toContain(
      "https://api.mytranspa.com/doc/openapi/v1/openapi.json",
    );
  });

  it("hittar en absolut url", () => {
    const html = `SwaggerUIBundle({url: 'https://api.mytranspa.com/doc/v1/spec.json'})`;
    expect(specUrlsFrom(html, BASE)).toContain("https://api.mytranspa.com/doc/v1/spec.json");
  });

  it("hittar flera specar i en urls-lista", () => {
    const html = `urls: [{url: "/doc/a.json", name: "A"}, {url: "/doc/b.yaml", name: "B"}]`;
    const found = specUrlsFrom(html, BASE);
    expect(found).toContain("https://api.mytranspa.com/doc/a.json");
    expect(found).toContain("https://api.mytranspa.com/doc/b.yaml");
  });

  it("tar configUrl, som Swagger UI också använder", () => {
    const html = `{ configUrl: "swagger-config.json" }`;
    expect(specUrlsFrom(html, BASE)).toContain(
      "https://api.mytranspa.com/doc/openapi/swaggerui/swagger-config.json",
    );
  });

  /* Sidan är full av .js och .css. Att prova dem som spec vore slöseri
     och skulle dölja den riktiga träffen bland brus. */
  it("plockar inte upp skript, stilmallar eller bilder", () => {
    const html = `<script src="swagger-ui-bundle.js"></script><link href="ui.css"><img src="logo.png">`;
    expect(specUrlsFrom(html, BASE)).toEqual([]);
  });

  it("tål en sida utan någon adress alls", () => {
    expect(specUrlsFrom("<html><body>inget här</body></html>", BASE)).toEqual([]);
  });

  it("hoppar över adresser som inte går att tolka", () => {
    const html = `url: "http://[trasig"`;
    expect(specUrlsFrom(html, BASE)).toEqual([]);
  });
});

/**
 * Swagger UI levereras med petstore.swagger.io som standardadress, och
 * den stod kvar i TransPA:s sida. Upptäckaren tog den, sidan listade
 * fjorton husdjursvägar och drog slutsatsen att TransPA inte har några
 * pass — ur ett helt annat API.
 */
describe("petstore-fällan", () => {
  it("plockar inte ens upp demo-adressen", () => {
    const html = `SwaggerUIBundle({ url: "https://petstore.swagger.io/v2/swagger.json" })`;
    expect(specUrlsFrom(html, BASE)).toEqual([]);
  });

  it("avvisar en spec som inte kan visa att den är TransPA:s", () => {
    expect(
      looksLikeTranspa(
        "https://petstore.swagger.io/v2/swagger.json",
        { host: "petstore.swagger.io", info: { title: "Swagger Petstore" } },
        ["/pet", "/pet/{petId}", "/store/order", "/user"],
      ),
    ).toBe(false);
  });

  it("godtar en spec som namnger TransPA", () => {
    expect(
      looksLikeTranspa(
        "https://api.mytranspa.com/doc/openapi.json",
        { servers: [{ url: "https://api.mytranspa.com/publicApi" }] },
        ["/v1/alive"],
      ),
    ).toBe(true);
  });

  /* En spec utan självidentifiering är inte automatiskt fel — men den
     måste då bära vägar vi själva bekräftat mot tenanten. */
  it("godtar en anonym spec vars vägar är de vi mätt", () => {
    expect(
      looksLikeTranspa("https://internal/spec.json", {}, ["/v1/employees", "/v1/stationPlaces"]),
    ).toBe(true);
  });

  it("avvisar en anonym spec med bara en bekant väg", () => {
    expect(looksLikeTranspa("https://internal/spec.json", {}, ["/v1/employees"])).toBe(false);
  });
});

/**
 * "Claim value mismatch: scope=transpaapi:timereports:read" är sidans
 * mest värdefulla svar: vägen finns, och API:t säger exakt vad som
 * saknas. Det får inte gå förlorat bland felraderna.
 */
describe("scopeFromDenial", () => {
  it("plockar ut scopet ur ett nekat svar", () => {
    expect(scopeFromDenial("Claim value mismatch: scope=transpaapi:timereports:read.")).toBe(
      "transpaapi:timereports:read",
    );
  });

  it("ger inget när svaret inte namnger ett scope", () => {
    expect(scopeFromDenial("403 från /v1/shifts")).toBeUndefined();
  });
});

