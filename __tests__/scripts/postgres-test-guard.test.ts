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

  it("accepts the CI postgres test database only when both opt-ins are exactly true", () => {
    expect(() => assertNonProductionDatabaseUrl(
      "postgresql://test:test@postgres:5432/autopilot_test",
      { ci: "true", allowCiPostgres: "true" },
    )).not.toThrow();
  });

  it.each([
    ["CI is missing", { ci: "", allowCiPostgres: "true" }],
    ["CI is incorrect", { ci: "TRUE", allowCiPostgres: "true" }],
    ["ALLOW_CI_POSTGRES is missing", { ci: "true", allowCiPostgres: "" }],
    ["ALLOW_CI_POSTGRES is incorrect", { ci: "true", allowCiPostgres: "TRUE" }],
  ])("rejects the CI postgres host when %s", (_condition, options) => {
    expect(() => assertNonProductionDatabaseUrl(
      "postgresql://test:test@postgres:5432/autopilot_test",
      options,
    )).toThrow(/non-production local database/i);
  });

  it.each([
    "postgresql://test:test@localhost:5432/autopilot_production_test",
    "postgresql://test:test@localhost:5432/autopilot_prod_test",
    "postgresql://test:test@localhost:5432/autopilot_test_production.foo",
    "postgresql://test:test@localhost:5432/autopilot_test_prod.foo",
    "postgresql://test:test@localhost:5432/autopilot_test_production%2Efoo",
    "postgresql://test:test@localhost:5432/autopilot_test_prod%2Efoo",
    "postgresql://test:test@localhost:5432/autopilot_productionX_test",
    "postgresql://test:test@localhost:5432/autopilot_prodX_test",
    "postgresql://test:test@localhost:5432/autopilot_test_backup",
    "postgresql://test:test@localhost:5432/autopilot_test2",
    "postgresql://test:test@localhost:5432/autopilot_test%2Fbackup",
    "postgresql://test:test@localhost:5432/autopilot%5Ftest_backup",
  ])("rejects a database path other than autopilot_test %s", (url) => {
    expect(() => assertNonProductionDatabaseUrl(url)).toThrow(/non-production/i);
  });
});
