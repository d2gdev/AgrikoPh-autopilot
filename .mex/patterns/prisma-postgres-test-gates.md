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
last_updated: 2026-07-18T14:10:00+08:00
---

# Prisma and PostgreSQL Test Gates

## Context

`npm run db:generate` must be followed by a current hash stamp based on `prisma/schema.prisma`, `package.json`, and `package-lock.json`. PostgreSQL integration tests live in `__tests__/integration/**` and run with `npm run test:postgres`; they must guard database access when `DATABASE_URL_TEST` is absent so ordinary `npm test` remains safe. `vitest.postgres.config.ts` validates `DATABASE_URL_TEST` before assigning it to `DATABASE_URL` for the PostgreSQL test process.

## Steps

1. After changing Prisma inputs or dependencies, run `npm run db:generate`.
2. Run `npm run verify:prisma-client` before application or test typechecks.
3. Place database-backed tests in `__tests__/integration/` because `vitest.postgres.config.ts` explicitly collects `__tests__/integration/**/*.test.ts`. Guard each suite against an absent `DATABASE_URL_TEST`; do not change test discovery to preserve obsolete documentation.
4. Use exactly `postgresql://test:test@127.0.0.1:5432/autopilot_test`; the URL-decoded database path must be exactly `autopilot_test`.
5. In CI, retain the PostgreSQL 16 pgvector service and set `DATABASE_URL_TEST`; the migration history creates the `vector` extension, so plain `postgres:16` is insufficient. Never use a production or secret database URL.

## Gotchas

- `prisma generate` alone is not enough for this repository: it must update the freshness stamp through `npm run db:generate`.
- The PostgreSQL guard rejects a missing URL, every host except `localhost`/`127.0.0.1`, and every URL-decoded database path except `autopilot_test`. Do not recreate a generic `test`-token allowlist plus a production-name denylist: composable names such as `autopilot_productionX_test` can bypass it. The `postgres` service hostname is allowed only when both `CI=true` and `ALLOW_CI_POSTGRES=true`.
- Keep the generated-client verification before both typecheck steps, otherwise a reused dependency cache can hide stale Prisma types.
- The default Vitest configuration still excludes the legacy `__tests__/postgres/**` path, but the active PostgreSQL configuration collects `__tests__/integration/**`. Integration suites must therefore use the guarded URL pattern; do not rely on the stale excluded path for isolation.

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
