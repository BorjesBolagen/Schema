import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
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
