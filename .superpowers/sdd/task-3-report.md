# Task 3 report

Status: DONE_WITH_CONCERNS

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

Pending at report creation; filled in by the task commit history.
