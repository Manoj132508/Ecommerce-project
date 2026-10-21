import { defineConfig } from "vitest/config";

// PostgreSQL migration tests (`npm run test:db`). They need Docker: the global
// setup starts a throwaway postgres:17-alpine container, separate from the
// development database in compose.yaml, and removes it afterwards.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/db/**/*.test.ts"],
    globalSetup: ["./test/db/globalSetup.ts"],
    testTimeout: 30_000,
    // Pulling the image on a first run can take a while.
    hookTimeout: 300_000,
  },
});
