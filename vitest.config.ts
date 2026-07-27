import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    hookTimeout: 20000,
    testTimeout: 20000,
    // Integration tests share a Postgres connection pool per file; run files serially
    // to avoid cross-file truncation races (LLD §1 test DB is truncated between tests).
    fileParallelism: false,
    setupFiles: ["tests/setupEnv.ts"],
  },
});
