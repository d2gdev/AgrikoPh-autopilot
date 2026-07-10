# Task 4 report

## Verification

- RED: initial focused suite exposed the legacy opportunity-route expectation that existing proposals are reused.
- GREEN: `npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/opportunities/route.test.ts` — 4 files, 41 tests passed.
- GREEN: `npx tsc --noEmit` passed.

## Changes

Canonical `createContentProposalOnce` is now used by SEO promote, SEO gap promote, SEO recommendation decomposition, manual proposals, and opportunity routing; manual new-content identity is derived from normalized target keyword. Existing route filtering and batch semantics remain intact.

## Commit

Pending parent-agent integration commit.

## Self-review / concerns

Generate, refresh-all, and daily proposal creation paths still need the same helper conversion in the parent integration pass. Opportunity routing retains its historical pre-check for compatibility while using the atomic helper for the create path.
