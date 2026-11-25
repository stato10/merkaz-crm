import path from "node:path";
import { defineConfig } from "vitest/config";
import { evalDbUrl } from "./evals/db-url";

/** Agent evals: real model calls (costs money), so they run only via `npm run eval`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    name: "eval",
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    globalSetup: ["evals/setup.ts"],
    env: { LOG_SILENT: "1", DATABASE_URL: evalDbUrl() },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 240_000,
    hookTimeout: 180_000,
  },
});
