# Task 3 report

Status: DONE

## Ground

- SEO analysis now separates raw GSC/on-page observations from active-map-governed content and internal-link candidates.
- Analysis snapshots persist schema-v2 strategy envelopes and cached reads fail closed unless version ID and package SHA-256 both match the active strategy.
- Promotions require exact strategy identity and non-empty rule IDs, reload/revalidate them server-side, and retain the existing governed proposal/compliance/dedupe transaction.

## TDD evidence

- RED: `npm test -- __tests__/lib/seo/analysis.test.ts` — 2 expected failures (`buildMapAwareSeoGaps` and `readAnalysisForStrategy` missing).
- GREEN: `npm test -- __tests__/lib/seo/analysis.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/topical-map/proposal-integration.test.ts __tests__/lib/content-pilot/create-proposal.test.ts` — 4 files, 51 tests passed.
- Typecheck: `npx tsc --noEmit` — passed.
- Lint: initial full lint exposed two task-local explicit-`any` errors; corrected with stored projection types. Existing unrelated warnings remain.

## Files

- `lib/seo/analysis.ts`
- `lib/topical-map/command-center.ts`
- `app/api/seo/analyze/route.ts`
- `app/api/seo/analysis/route.ts`
- `app/api/seo/gaps/promote/route.ts`
- `__tests__/lib/seo/analysis.test.ts`
- `__tests__/api/seo-pilot-routes.test.ts`
- `.mex/ROUTER.md`

## Self-review

- Embedded handlers retain `requireAppAuth` first; mutation permission remains immediately second.
- No direct Prisma client, live-execution changes, technical SEO execution, or canonical/indexation authorization was introduced.
- Promotion still uses `createGovernedContentProposalInTransaction`, preserving normalization, evaluator compliance evidence, and idempotent proposal creation.
- Exact rule IDs are checked against the active command-center provenance before transaction evaluation and are persisted in proposal source context.

## Concerns

- The existing SEO Pilot client does not yet send schema-v2 strategy/rule context. Until its command-center UI wiring lands, legacy client promotion requests correctly fail with 400 instead of bypassing governance.
- Prohibited suppression is exact governed-URL matching; semantic policy remains the responsibility of the existing topical-map evaluator during promotion.

## Commit

Implementation commit: `694c7f20aed0af5636bda39e0e63394108393c82`.

## Review-finding remediation

- Eliminated activation TOCTOU: callers pass the expected version ID/package hash into `createGovernedContentProposalInTransaction`; the active policy loaded by that transaction is compared before evaluation or persistence. `StrategyChangedError` is mapped to HTTP 409 `STRATEGY_CHANGED`.
- Bound rule evidence to candidates: promotion resolves exact content action/target or internal-link source/destination against the active server projection, requires exact rule-set equality, and persists the server-selected rule IDs rather than request-authored provenance.
- Hardened cached envelopes: strict schemas now validate every gap, observation, and suppressed item, including candidate kind/state/action, non-empty rule IDs, and item-level version/hash equality with the envelope.
- Replaced generic request mutation in tests with explicit governed promotion fixtures; added stale transaction activation, unrelated active rule, malformed gap, and per-item identity mismatch coverage.

### Remediation evidence

- RED: focused analysis/proposal tests failed on permissive cached gaps and missing transaction identity enforcement.
- GREEN: `npm test -- __tests__/lib/seo/analysis.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/topical-map/proposal-integration.test.ts __tests__/lib/topical-map/evaluator.test.ts __tests__/lib/content-pilot/create-proposal.test.ts` — 5 files, 65 tests passed.
- `npx tsc --noEmit` — passed.
- Targeted ESLint across all changed production/tests — passed with no findings.
- `git diff --check` — passed.

## Internal-link promotion correction

- Corrected the earlier overbroad claim that all map gaps promoted through an authoritative candidate: required-link gaps now have a dedicated `internal-link` proposal row and `{ type: "internal_link", fromUrl, toUrl }` evaluator candidate.
- The path normalizes and validates exact source/destination against the active required-link rule, bypasses unrelated article/title lookup, retains server-selected anchor/purpose/priority and exact rule provenance, and continues through the governed transaction and proposal dedupe key.
- Added successful normalized internal-link promotion coverage plus fail-closed missing-target coverage. Existing `createContentProposalOnce`/internal-link dedupe tests cover persistence idempotency.
- RED: focused route test returned 409 because the required-link gap fell through the content-oriented path instead of producing a link row.
- GREEN/final: six suites (`analysis`, SEO routes, proposal integration, evaluator, proposal creation, proposal dedupe) passed 75/75 tests; `npx tsc --noEmit`, targeted ESLint, and `git diff --check` all passed.
