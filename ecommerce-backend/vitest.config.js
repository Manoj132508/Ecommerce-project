import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    setupFiles: ["./test/setup.js"],
    // bcrypt cost 12 is deliberately slow, and the first run downloads a MongoDB binary.
    testTimeout: 30_000,
    hookTimeout: 300_000,
  },
});
