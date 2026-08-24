import { describe, expect, it } from "vitest";
import { sslSetting } from "./index";

describe("TLS-läge ur anslutningssträngen", () => {
  it("kräver TLS mot hostad databas utan sslmode, utan att kräva ett betrott certifikat", () => {
    /* "require", inte det booleska true: postgres-drivrutinen stänger
       bara av certifikatverifieringen för "require"/"allow"/"prefer" —
       true matchar ingen av de grenarna och faller igenom till Nodes
       strikta standard, vilket gav SELF_SIGNED_CERT_IN_CHAIN mot
       Supabase pooler i drift trots en helt korrekt anslutningssträng. */
    expect(
      sslSetting("postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true"),
    ).toBe("require");
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
