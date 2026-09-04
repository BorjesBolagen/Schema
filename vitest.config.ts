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
    /*
     * Proven får aldrig röra utvecklingsdatabasen på disk.
     *
     * De flesta skapar sin egen med createDb("memory://"), men den som
     * bara anropar getDb() fick förvalet — alltså ./.pgdata, katalogen
     * dev-servern kör mot. Två sådana: den läser data ingen lagt dit
     * med flit, och timeout-provet, som med flit pensionerar en
     * koppling, fick två PGlite-instanser öppna på *samma katalog*.
     * Wasm-körningen avbröt i nedstängningen, och hela körningen slutade
     * med felkod trots att varje enskilt prov var grönt — ett rött som
     * gick att missa genom att titta på sista raden i stället för på
     * utgångskoden.
     */
    env: { PGLITE_DIR: "memory://" },
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
