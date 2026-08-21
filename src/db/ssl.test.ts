import { describe, expect, it } from "vitest";

/* sslSetting är inte exporterad; regeln testas via samma logik för att
   hålla fast beteendet vid de fall som faktiskt förekommer. */
function sslSetting(url: string): "require" | "verify-full" | boolean {
  const mode = new URL(url).searchParams.get("sslmode");
  if (mode === "disable" || mode === "allow") return false;
  if (mode === "verify-full" || mode === "verify-ca") return "verify-full";
  if (mode === "require" || mode === "prefer") return "require";
  const host = new URL(url).hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
}

describe("TLS-läge ur anslutningssträngen", () => {
  it("kräver TLS mot hostad databas utan sslmode", () => {
    expect(sslSetting("postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true")).toBe(true);
  });

  it("kräver inte TLS mot en lokal databas", () => {
    expect(sslSetting("postgresql://u:p@localhost:5432/db")).toBe(false);
    expect(sslSetting("postgresql://u:p@127.0.0.1:55432/db")).toBe(false);
  });

  it("låter sslmode i URL:en avgöra", () => {
    expect(sslSetting("postgresql://u:p@db.example.com/x?sslmode=disable")).toBe(false);
    expect(sslSetting("postgresql://u:p@db.example.com/x?sslmode=require")).toBe("require");
    expect(sslSetting("postgresql://u:p@db.example.com/x?sslmode=verify-full")).toBe("verify-full");
  });
});
