import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One test file at a time: every file uses the same database, and the locks
    // per vehicle type (pg_advisory_xact_lock) are shared by all its connections.
    // A test holds them until its transaction rolls back, so two files at once
    // make each other wait and the tests of the locks fail by timing (S3-10).
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/*.test.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        "src/domain/**": { lines: 80 },
      },
    },
  },
});
