import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDbUrl } from "./tests/support/test-db";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          env: { LOG_SILENT: process.env.LOG_SILENT ?? "1", DATABASE_URL: testDbUrl() },
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
