import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Node by default; component tests opt into jsdom with a docblock.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.tsx"],
    // Interaction-heavy accessibility tests can exceed Vitest's five-second
    // default on shared CI runners while remaining deterministic.
    testTimeout: 10_000,
  },
});
