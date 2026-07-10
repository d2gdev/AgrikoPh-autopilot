import { describe, expect, it } from "vitest";
import { assertNonProductionDatabaseUrl } from "../../scripts/postgres-test-guard.mjs";

describe("assertNonProductionDatabaseUrl", () => {
  it.each([
    "postgresql://user:pass@prod.example.com/autopilot",
    "postgresql://user:pass@10.0.0.9/autopilot",
  ])("rejects non-local database %s", (url) => {
    expect(() => assertNonProductionDatabaseUrl(url)).toThrow(/non-production/i);
  });

  it.each([
    "postgresql://test:test@127.0.0.1:5432/autopilot_test",
    "postgresql://test:test@localhost:5432/autopilot_test",
  ])("accepts local test database %s", (url) => {
    expect(() => assertNonProductionDatabaseUrl(url)).not.toThrow();
  });
});
