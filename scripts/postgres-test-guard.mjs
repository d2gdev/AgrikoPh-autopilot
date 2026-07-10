#!/usr/bin/env node

export function assertNonProductionDatabaseUrl(url, {
  ci = process.env.CI,
  allowCiPostgres = process.env.ALLOW_CI_POSTGRES,
} = {}) {
  if (!url) {
    throw new Error("A non-production DATABASE_URL_TEST is required.");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL_TEST must be a valid non-production PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL_TEST must use a non-production PostgreSQL URL.");
  }

  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const ciServiceHost = parsed.hostname === "postgres" && ci === "true" && allowCiPostgres === "true";
  if (!localHost && !ciServiceHost) {
    throw new Error("DATABASE_URL_TEST must point to a non-production local database.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (databaseName !== "autopilot_test") {
    throw new Error("DATABASE_URL_TEST must use the exact non-production autopilot_test database.");
  }
}

if (process.argv[1] && process.argv[1].endsWith("postgres-test-guard.mjs")) {
  assertNonProductionDatabaseUrl(process.env.DATABASE_URL_TEST);
  console.log("DATABASE_URL_TEST is restricted to a non-production test database.");
}
