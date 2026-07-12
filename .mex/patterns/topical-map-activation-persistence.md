---
name: topical-map-activation-persistence
description: Persist immutable topical-map packages, then atomically activate, supersede, or roll back validated versions.
triggers:
  - "topical-map activation"
  - "strategy package import"
  - "strategy rollback"
last_updated: 2026-07-13T00:00:00+08:00
---

# Topical-map Activation Persistence

## Context

`importAndValidatePackage` is the only persistence boundary. It compiles and validates an already loaded package with an explicit `asOf`, then writes all six artifacts, compiled rules, validation issues, and the full report atomically. It never creates an activation pointer.

The currently approved contract is validation/import-only: both activation
eligibility and runtime activation authorization are false. The activation
service therefore fails closed before opening its lifecycle transaction. Do not
remove that guard or add an activation path without a separately approved
runtime-authorization design. An audited rollback remains the only defined
strategy-reversion mechanism for an already active historical state; it is not
a schema rollback.

## Lifecycle

1. A zero-blocking-issue report stores the package as `validated`; a report with blocking issues stores it as `rejected` with all report and freshness data intact.
2. A same-host/same-hash retry must return only a coherent existing version. Missing, duplicated, or report-conflicting child data is a typed conflict, never a repair.
3. Activation takes a PostgreSQL transaction advisory lock scoped to the site and conditionally claims only a `validated` target. It updates the unique pointer and audit row in the same transaction; a prior active version is `superseded`.
4. Rollback takes the same lock, accepts only a different same-site `superseded` or `rolled_back` version whose `validationStatus` is `valid`, changes the current active version to `rolled_back`, restores the target to `active`, and records no artifact bytes in audit data.

## Verification

- Unit tests: `npm test -- __tests__/lib/topical-map/activation.test.ts`
- PostgreSQL tests live in `__tests__/integration/topical-map-activation.test.ts`, are guarded by `DATABASE_URL_TEST`, and must use only `postgresql://test:test@127.0.0.1:5432/autopilot_test`.
- After Prisma changes: `npm run db:generate && npm run verify:prisma-client`, then run `DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres`.

## Boundary

This service contains no route, filesystem read, evaluator, cron, Shopify/Meta integration, recommendation execution, production access, or deployment behavior. A lifecycle transition is local persistence only and is not authorization to make a live change.

## Secured Operator API

The embedded `app/api/topical-map/packages` routes are the sole operator entry point for this boundary. Their GET handlers call `requireAppAuth` first and use explicit Prisma projections that exclude `rawContent` and compiled source bytes. Every mutation calls `requireAppAuth` first, then `requirePermission(req, PERMISSIONS.SETTINGS_ADMIN)` before resolving params, parsing a body, reading `TOPICAL_MAP_STRATEGY_ROOT`, reading the filesystem, querying Prisma, or calling an activation service. Import injects `new Date().toISOString()` into `importAndValidatePackage`; it never accepts caller freshness. Activation and rollback use `agrikoph.com`, `getSessionUser` attribution, and only an optional non-empty reason of at most 500 characters. Map `StrategyActivationConflictError` to a safe 409 and known strategy validation failures to a typed 422; do not return paths, raw package content, stack traces, or unknown exception messages.
