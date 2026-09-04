/**
 * Mätkörningen, skild från testkörningen.
 *
 * Samma villkor och alias som vitest.config.ts — mätningen importerar
 * server-only-moduler och behöver dem — men den plockar bara upp
 * *.bench.ts, så den aldrig råkar följa med i `npx vitest run`.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.bench.ts"],
    disableConsoleIntercept: true,
    hookTimeout: 600_000,
    testTimeout: 600_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    conditions: ["react-server"],
  },
  ssr: { resolve: { conditions: ["react-server"] } },
});
