---
name: topical-map-strategy-package
description: Safely operate the complete topical-map strategy package across migration, validation/import, activation, and rollback boundaries.
triggers:
  - "topical-map strategy package"
  - "topical-map migration"
  - "topical-map import"
  - "topical-map rollback"
edges:
  - target: topical-map-validation.md
    condition: when validating raw and compiled package eligibility
  - target: topical-map-activation-persistence.md
    condition: when persisting, activating, or rolling back a version
  - target: prisma-postgres-test-gates.md
    condition: when changing Prisma schema or running PostgreSQL verification
last_updated: 2026-07-13
---

# Topical-map Strategy Package Operations

## Context

The authority is exactly one complete six-artifact package plus its manifest:
map, evidence, URL inventory, redirect inventory, internal-link matrix, and
compilation contract. Its semantic identity is package SHA-256
`100b4ba60036fc3a93f98fc81964962c564969db03d21613d2aeeac60e57cf5a`; the
approved contract is revision 2 with SHA-256
`4d1cf3a8583a572ec0e928926ed08057dfdb1fb201b01e177ddb8a35c54b7559`.

The approved July 12 package is eligible for validation/import only.
`activationEligible` and `runtimeActivationAuthorized` are both false. No
partial package, source inference, AI output, import, or validation result has
activation or live-execution authority.

## Validation and Import

1. Supply the package only through the absolute server-only
   `TOPICAL_MAP_STRATEGY_ROOT`.
2. Use the authenticated, `SETTINGS_ADMIN` operator route. Validation is
   operator-triggered; no topical-map validation cron or job exists.
3. Validate all six artifact hashes, the strict contract, coverage, compiled
   projection, and typed freshness at the route-supplied UTC `asOf`.
4. Persist only through `importAndValidatePackage`, which atomically records a
   coherent immutable version and full validation report. Import/validation
   never activates a strategy and never writes to Shopify or Meta.
5. Preserve safe validation evidence. A blocked/rejected result is an operator
   decision blocker, never an invitation to repair protected artifacts at
   runtime.

## Migration and Deployment

1. Back up and verify the target database before applying the expand-only
   topical-map Prisma migration.
2. Apply committed migration history with `npx prisma migrate deploy`.
3. Do not perform destructive schema rollback. Keep the migration in place.
4. If a strategy must be reverted, use the same-site audited activation-pointer
   rollback to an already validated historical version. This changes strategy
   selection only; it is not a schema rollback and does not write Shopify/Meta.
5. Do not deploy, activate, or execute a strategy without separate operator
   authority and fresh acceptance evidence.

## Activation and Review Boundaries

- Activation is a separate audited transaction that requires an eligible,
  validated version; it is never an import side effect.
- Proposal evaluation remains deterministic and `executionAuthorized: false`.
  Existing ContentProposal approvals, permissions, AuditLog, guardrails, and
  live-execution controls remain authoritative.
- Redirect, canonical, and indexation outcomes are proposal/review evidence,
  not technical execution instructions.

## Verify

1. `npm run db:generate`
2. `npm run verify:prisma-client`
3. `npm test`
4. `npm run typecheck`
5. `npm run typecheck:test`
6. `npm run lint`
7. `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/autopilot_test?connection_limit=1&pool_timeout=5' npm run build`
8. `git diff --check`
9. `DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres`

## Gotchas

- Do not add a validation cron without separately approved cron design that
  begins with `requireCronAuth` and then acquires a job lock.
- Do not expose raw artifacts, manifests, contracts, source prose, or arbitrary
  audit JSON to the browser.
- Use `.mex/patterns/topical-map-validation.md` and
  `.mex/patterns/topical-map-activation-persistence.md` for focused boundary
  changes; this runbook consolidates the cross-boundary operational contract
  without replacing that historical guidance.
