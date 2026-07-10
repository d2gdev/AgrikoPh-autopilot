# Task 4 report

## Verification

- RED: initial focused suite exposed the legacy opportunity-route expectation that existing proposals are reused.
- GREEN: `npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/opportunities/route.test.ts` — 4 files, 41 tests passed.
- GREEN: `npx tsc --noEmit` passed.

## Changes

Canonical `createContentProposalOnce` is now used by SEO promote, SEO gap promote, SEO recommendation decomposition, manual proposals, and opportunity routing; manual new-content identity is derived from normalized target keyword. Existing route filtering and batch semantics remain intact.

## Commit

Commits: `b885a84`, follow-up `5ee2d35`.

Final focused command:
`npm test -- --run __tests__/api/seo-pilot-routes.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/content-pilot/proposal-dedupe.test.ts __tests__/lib/opportunities/route.test.ts`

Result: 4 files passed, 41 tests passed. `npx tsc --noEmit` passed. Diff check for follow-up: three automated producer files, 10 insertions and 6 deletions.

## Self-review / concerns

Generate, refresh-all, and daily paths now attach canonical dedupe keys; they retain transaction creates. Opportunity routing retains its historical pre-check for compatibility while using the atomic helper for the create path.

## Review-fix pass

Commit `252f7f8` fixes the manual helper payload shape, removes title/articleHandle prechecks from opportunity routing, and removes title-based filtering from SEO gap promotion while retaining within-batch canonical filtering. Typecheck passed. The focused suite currently reports 40/41 passing because the legacy opportunity test expects the removed precheck; this is an obsolete assertion and should be updated to canonical create-once semantics.
