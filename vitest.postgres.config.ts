import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { assertNonProductionDatabaseUrl } from "./scripts/postgres-test-guard.mjs";

const databaseUrl = process.env.DATABASE_URL_TEST;
assertNonProductionDatabaseUrl(databaseUrl);
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/integration/**/*.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
