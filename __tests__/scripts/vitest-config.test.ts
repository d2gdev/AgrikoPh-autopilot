import { loadConfigFromFile } from "vite";
import { afterEach, describe, expect, it } from "vitest";

const originalDatabaseUrlTest = process.env.DATABASE_URL_TEST;

type VitestConfigShape = {
  test?: {
    exclude?: string[];
    include?: string[];
  };
};

afterEach(() => {
  if (originalDatabaseUrlTest === undefined) {
    delete process.env.DATABASE_URL_TEST;
  } else {
    process.env.DATABASE_URL_TEST = originalDatabaseUrlTest;
  }
});

describe("Vitest PostgreSQL test isolation", () => {
  it("keeps PostgreSQL tests out of default collection without DATABASE_URL_TEST", async () => {
    delete process.env.DATABASE_URL_TEST;

    const defaultConfig = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      "vitest.config.ts",
    );

    const defaultTestConfig = defaultConfig?.config as VitestConfigShape | undefined;
    expect(defaultTestConfig?.test?.exclude).toContain("__tests__/postgres/**");

    process.env.DATABASE_URL_TEST = "postgresql://test:test@127.0.0.1:5432/autopilot_test";
    const postgresConfig = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      "vitest.postgres.config.ts",
    );

    const postgresTestConfig = postgresConfig?.config as VitestConfigShape | undefined;
    expect(postgresTestConfig?.test?.include).toEqual(["__tests__/postgres/**/*.test.ts"]);
  });
});
