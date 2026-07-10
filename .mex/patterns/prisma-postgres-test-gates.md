---
name: prisma-postgres-test-gates
description: Keep generated Prisma clients fresh and PostgreSQL integration tests confined to an explicit non-production database.
triggers:
  - "Prisma client stale"
  - "Prisma generate"
  - "PostgreSQL integration test"
  - "DATABASE_URL_TEST"
  - "test:postgres"
edges:
  - target: context/setup.md
    condition: when running local verification commands
  - target: context/conventions.md
    condition: when database access is added to an integration test
last_updated: 2026-07-10T20:20:00Z
---

# Prisma and PostgreSQL Test Gates

## Context

`npm run db:generate` must be followed by a current hash stamp based on `prisma/schema.prisma`, `package.json`, and `package-lock.json`. The default Vitest configuration explicitly excludes `__tests__/postgres/**`, so ordinary `npm test` does not require or read `DATABASE_URL_TEST`. PostgreSQL integration tests use `DATABASE_URL_TEST` only; `vitest.postgres.config.ts` validates it before assigning it to `DATABASE_URL` for the test process.

## Steps

1. After changing Prisma inputs or dependencies, run `npm run db:generate`.
2. Run `npm run verify:prisma-client` before application or test typechecks.
3. Place database-backed tests in `__tests__/postgres/` so `npm run test:postgres` is isolated from the mocked Vitest suite.
4. Use a local URL with an unmistakable test database name, for example `postgresql://test:test@127.0.0.1:5432/autopilot_test`.
5. In CI, retain the PostgreSQL 16 service and set `DATABASE_URL_TEST`; never use a production or secret database URL.

## Gotchas

- `prisma generate` alone is not enough for this repository: it must update the freshness stamp through `npm run db:generate`.
- The PostgreSQL guard rejects a missing URL, production-looking database names, and all non-local hosts. Production-name detection treats any non-alphanumeric character as a token boundary after URL decoding, so names such as `autopilot_test_production%2Efoo` are rejected. The `postgres` service hostname is allowed only when both `CI=true` and `ALLOW_CI_POSTGRES=true`.
- Keep the generated-client verification before both typecheck steps, otherwise a reused dependency cache can hide stale Prisma types.
- Keep `__tests__/postgres/**` in the default Vitest `exclude` list. The PostgreSQL config's `include` is not enough by itself because the default suite otherwise discovers future integration files.

## Verify

- `npm run db:generate`
- `npm run verify:prisma-client`
- `DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres`
- `npm run typecheck`
- `npm run typecheck:test`

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` when the verification contract changes.
- [ ] Update `.mex/context/setup.md` when command or local database requirements change.
- [ ] Update this pattern and `.mex/patterns/INDEX.md` if integration test location or CI host rules change.
