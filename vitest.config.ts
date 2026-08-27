import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    /* Flera testfiler startar var sin PGlite, och den startar hela
       Postgres i wasm. Var för sig tar det ett par sekunder; körs de
       parallellt slåss de om samma kärnor och en enskild uppstart kan
       passera tio sekunder. Då föll setup-sql-testet på hook-timeout
       trots att det var grönt när det kördes ensamt — ett falskt rött
       som kostar mer förtroende än de sparade sekunderna är värda. */
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // Samma villkor Next sätter för server-bundeln. Utan det slår
    // "server-only" om och kastar redan vid import, eftersom paketet
    // annars antar att den körs i en klientmodul. Testerna körs i
    // Vites SSR-läge, som läser sina egna conditions — därför krävs
    // båda.
    conditions: ["react-server"],
  },
  ssr: {
    resolve: { conditions: ["react-server"] },
  },
});
