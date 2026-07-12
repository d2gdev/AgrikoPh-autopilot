# Task 1 Report: Runtime production activation gate

Status: DONE

## Outcome

- Added `runtimeActivationEnabled()`, returning true only when `TOPICAL_MAP_ACTIVATION_ENABLED` is exactly `"true"`.
- Kept the authorization check before the initial active-pointer query and lifecycle transaction.
- Preserved the existing validated-target claim, active-pointer race check, serializable transaction, advisory lock, pointer update, supersession, and audit behavior.
- Documented `TOPICAL_MAP_ACTIVATION_ENABLED=false` as server-only, strategy-selection-only, and independent of Shopify/Meta live execution.
- Preserved route ordering: embedded auth first, `SETTINGS_ADMIN` permission second, then request/service/database boundaries.

## TDD evidence

- RED: `npm test -- __tests__/lib/topical-map/activation.test.ts __tests__/api/topical-map-routes.test.ts`
  - Expected result observed: 2 failures, 25 passes.
  - Failures were specifically the absent `runtimeActivationEnabled` export and exact `true` still reaching the prior hardcoded rejection.
- GREEN: same focused command.
  - Result: 2 files passed, 28 tests passed, 0 failed.

Tests cover absent, empty, `false`, and non-exact `TRUE` values rejecting before database access; exact `true` reaching and completing the existing validated lifecycle transaction; and route auth/permission ordering before enabled activation database access.

## Verification

- `npm run typecheck`: pass.
- `npm run typecheck:test`: pass.
- `npm run lint`: pass with 0 errors and 115 pre-existing repository warnings; none are in the task's changed TypeScript files.
- `git diff --check`: pass.
- Focused tests: 28/28 pass.

## Self-review

- The flag comparison is exact and case-sensitive with no trimming or permissive coercion.
- Disabled values cannot execute the preliminary Prisma read, open a transaction, acquire a lock, mutate lifecycle state, update the active pointer, or create audit history.
- The enabled path changes no transaction semantics.
- No live execution flag, recommendation status, Shopify connector, Meta connector, route permission, schema, migration, cron, or deployment behavior was changed.
- No unrelated pre-existing working-tree changes were present at task start.

## GROW

- Ground: topical-map strategy selection is runtime-gated and remains default-off.
- Record: updated `.mex/ROUTER.md` and logged the decision in `.mex/events/decisions.jsonl`.
- Orient: updated `.mex/patterns/topical-map-activation-persistence.md` with exact flag semantics and the live-execution boundary.
- Write: bumped the pattern `last_updated` value and ran `mex log --type decision`.

## Concerns

The repository-wide lint command reports 115 pre-existing warnings but zero errors; none are in the task's changed TypeScript files. This task does not set the production flag, activate a strategy, deploy code, or authorize Shopify/Meta writes.
