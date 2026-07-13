# Task 6 report

Status: DONE_WITH_CONCERNS

## Ground

- Deleted `lib/seo/keyword-strategy.ts` and the static `StrategyPanel.tsx`.
- Removed the unreachable tab-8 render branch, legacy imports, bulk primary tracking, static target planning, and their associated state.
- Preserved the reviewed five-tab command-center behavior through `926b384`; no current map action handlers were changed.
- Explicit keyword tracking was not removed from a reachable UI: the old `KeywordsPanel` import and tracking handlers were already unreachable after the five-tab cutover, so that dead path was removed with the rest of the legacy branch.
- Added a recursive runtime-source scan covering all `.ts`/`.tsx` files below the SEO Pilot UI and `lib/seo`.

## TDD evidence

- RED: `npm test -- __tests__/components/topical-map-strategy-panel.test.ts` failed 1/7 because runtime sources still contained `KEYWORD_CLUSTERS`.
- GREEN: the same test passed 7/7 after legacy removal.
- Focused suite: `npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/seo/analysis.test.ts` passed 4 files, 72 tests.
- Regression scan: `rg -n 'KEYWORD_CLUSTERS|PRIMARY_TARGETS|SECONDARY_BANK|ROADMAP|June 2026 keyword research report|keyword-strategy' app lib __tests__` returned only the regression test's forbidden declarations/assertion.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: exited 0 with 128 existing warnings and 0 errors. Warnings include dead code retained elsewhere in the historically large SEO page; this task removed only the reviewed June-strategy path.
- `git diff --check`: passed.
- `npm run build`: Next.js compilation succeeded, then page-data collection failed because neither `DATABASE_URL` nor `DATABASE_URL_PROD` is available in this worktree. The reported failures were unrelated ad-approval API routes loading the database boundary.

## Router verify checklist

1. New API route dynamic export: not applicable; no route added.
2. Embedded handler auth first: not applicable; no handler changed.
3. Cron auth and job lock: not applicable; no cron changed.
4. Prisma import convention: passed by scope; no database access added or changed.
5. Zod validation before persistence: not applicable; no LLM/persistence path changed.
6. No public secret environment variable: passed by scope; no environment access changed.
7. Job result shape: not applicable; no job changed.
8. Skill prompts in Markdown: not applicable; no skill prompt changed.

## GROW

- Record: updated `.mex/ROUTER.md` with the removal boundary.
- Orient: no new runbook was created; the existing topical-map operator-surface pattern and the new executable regression test cover recurrence.
- Write: this report captures rationale and verification. No production deployment, database change, strategy activation, or live Shopify/Meta write occurred.

## Concern

The only completion concern is the environment-blocked build page-data phase. Compilation, typecheck, lint exit status, focused tests, and the runtime scan all have fresh passing evidence.
