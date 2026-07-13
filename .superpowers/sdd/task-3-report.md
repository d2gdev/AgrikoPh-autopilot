# Task 3 report

Status: DONE

## Ground

- Added authenticated, `CONTENT_REVIEW`-gated topical-map Store Task synchronization with an actor-keyed five-per-minute limit and safe errors.
- Added authenticated, `CONTENT_PUBLISH`-gated confirmed apply routing that accepts only the route ID and delegates all mutation orchestration to the apply service.
- The apply service fails closed across live enablement, executable task parsing, exact active strategy/rules/action, current Shopify state, atomic claim, allowlisted mutation, and returned-state verification.
- Shopify calls occur outside Prisma transactions. Successful and failed claimed tasks receive safe terminal state and audit evidence.
- Legacy Store Task PATCH can dismiss executable topical-map tasks but cannot manually complete them; ordinary task completion is unchanged.
- No production access or real Shopify call occurred.

## TDD evidence

- RED (service/routes): focused Vitest run failed because `apply-topical-map.ts` and both route modules did not exist (2 files failed; route tests 4/4 failed).
- GREEN (service/routes): focused run passed 14/14 tests after minimal implementation.
- RED (legacy PATCH): `__tests__/api/store-tasks-route.test.ts` observed HTTP 200 instead of required 409 for manual completion (1 failed, 2 passed).
- GREEN/final: `npx vitest run __tests__/api/topical-map-store-tasks.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/api/store-tasks-route.test.ts` passed 3 files, 17/17 tests.
- `npm run typecheck` passed.
- `git diff --check` passed.

## Self-review

- `requireAppAuth(req)` is the first handler statement and the permission check is immediately second in both new routes.
- Proposed state is loaded from Prisma and strictly parsed with Task 2 schemas; clients cannot supply mutation fields.
- Exact target/action/rule identity is revalidated against the active command-center projection before observation or claim.
- The claim is atomic and precedes exactly one adapter mutation; duplicate claims cannot mutate Shopify.
- Returned Shopify state must match every proposed field before completion.
- Audit payloads contain only bounded before/after state and strategy/rule receipts; caught Shopify details are not persisted or returned.

## Concerns

- `npm run typecheck:test` still reports three pre-existing missing `seo-pilot-responsive.module.css` imports outside Task 3; Task 3 itself adds no test-typecheck errors.

## Review-finding remediation

- Executable source evidence is now action-discriminated. Content and SEO tasks persist their exact action and content-decision domain; internal-link tasks additionally persist exact normalized destination and anchor.
- Apply revalidation binds source action, governed target type/URL, exact active action/domain/rule IDs, and—for links—the active source, destination, anchor, and deterministic proposed body before observation, claim, or mutation.
- The legacy PATCH route blocks completion from the minimal fail-closed marker `{ source: "topical-map", executable: true }`, even when all remaining source or proposal data is malformed. Dismissal remains available.
- Sync and apply route permission-denial regressions prove the service, rate-limit, Prisma, and Shopify boundaries remain untouched after authorization fails.
- High-risk route and apply orchestration branches were expanded from dense one-liners for auditability.

### Remediation TDD evidence

- RED: Task 2/3 focused run failed 13 tests: missing link provenance, malformed executable source still completing with HTTP 200, and forged source/action/target/link evidence reaching the wrong gate.
- GREEN: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts __tests__/api/topical-map-store-tasks.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/api/store-tasks-route.test.ts` passed 4 files, 36/36 tests.
- `npm run typecheck` passed.
- Targeted ESLint passed with no findings.
- `git diff --check` passed.
