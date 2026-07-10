#!/usr/bin/env node

function isAllowedTestDatabaseName(databaseName) {
  return /(^|[_-])test([_-]|$)/i.test(databaseName);
}

function isProductionDatabaseName(databaseName) {
  return /(^|[^a-z0-9])prod(?:uction)?(?=$|[^a-z0-9])/i.test(databaseName);
}

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

  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  if (isProductionDatabaseName(databaseName)) {
    throw new Error("DATABASE_URL_TEST must use a non-production test database name.");
  }

  if (!isAllowedTestDatabaseName(databaseName)) {
    throw new Error("DATABASE_URL_TEST must use a non-production test database name.");
  }
}

if (process.argv[1] && process.argv[1].endsWith("postgres-test-guard.mjs")) {
  assertNonProductionDatabaseUrl(process.env.DATABASE_URL_TEST);
  console.log("DATABASE_URL_TEST is restricted to a non-production test database.");
}
