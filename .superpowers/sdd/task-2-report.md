# Task 2 Report: Source Registry

## What I implemented
- Added [`lib/skills/source-registry.ts`](/home/sean/Agriko/auto-pilot/lib/skills/source-registry.ts) with:
  - `SourceState`, `SourceStatus`, and `SourceRefreshResult`
  - `checkSourceStatus(source, freshnessHours?)`
  - `refreshSourcesOnce(sources)`
  - `selectBaseSnapshotForSource(source)`
- Added [`__tests__/lib/skills/source-registry.test.ts`](/home/sean/Agriko/auto-pilot/__tests__/lib/skills/source-registry.test.ts) covering:
  - recent raw-snapshot status (`gsc`)
  - table-backed missing status (`keyword_research`)
  - table-backed `market_intel` evidence using open `MarketInsight`
  - `blog` evidence via `ArticleSnapshot`
  - grouped refresh deduping for SEO and market-intel sources
  - `market_intel` base snapshot selection among `dataforseo_ranked`, `dataforseo_keyword_gap`, and `shopify_catalog`

## Test commands and results
- `npm test -- source-registry`
  - RED: failed because `@/lib/skills/source-registry` did not exist
  - GREEN: passed, `1` test file and `7` tests green

## TDD Evidence
### RED
- Wrote `__tests__/lib/skills/source-registry.test.ts` first
- Ran `npm test -- source-registry`
- Observed expected failure:
  - `Cannot find package '@/lib/skills/source-registry'`

### GREEN
- Implemented `lib/skills/source-registry.ts`
- Re-ran `npm test -- source-registry`
- Observed success:
  - `Test Files  1 passed (1)`
  - `Tests  7 passed (7)`

## Files changed
- `lib/skills/source-registry.ts`
- `__tests__/lib/skills/source-registry.test.ts`
- `.superpowers/sdd/task-2-report.md`

## Self-review findings
- `market_intel` status does not depend on a nonexistent `RawSnapshot("market_intel")`; it uses open `MarketInsight` rows instead.
- `selectBaseSnapshotForSource("market_intel")` intentionally avoids Meta and picks the freshest of `dataforseo_ranked`, `dataforseo_keyword_gap`, and `shopify_catalog`.
- `blog` is treated as table-backed via `ArticleSnapshot`, matching the current fetch job behavior instead of inventing a raw snapshot source.
- Refreshes are bounded:
  - `gsc`, `gsc_query_page`, `ga4` share one SEO refresh
  - `market_intel`, `dataforseo_ranked`, `shopify_catalog` share one market-intel refresh

## Any concerns
- The workspace already had unrelated dirty changes, including shared `.mex/*` files. I left those untouched and staged only Task 2 files.

## Review findings follow-up (2026-07-09)
- Fixed `market_intel` status so it no longer reports `missing` when there is no open `MarketInsight` row but a fresh selectable market evidence snapshot exists (`dataforseo_ranked`, `dataforseo_keyword_gap`, or `shopify_catalog`).
- Updated `selectBaseSnapshotForSource("keyword_research")` to prefer a real `RawSnapshot("keyword_research")` when present, otherwise synthesize a bounded payload from up to 100 latest `KeywordResearchResult` rows ordered by `capturedAt desc, keyword asc`.
- The synthetic keyword-research fallback now emits a multi-row `keywords` payload and stringifies bid-micros fields so downstream JSON serialization stays safe.

### Verification
- `npm test -- source-registry`
  - PASS: `Test Files  1 passed (1)`
  - PASS: `Tests  9 passed (9)`

## Review findings follow-up (2026-07-09, remaining source-registry issue)
- Fixed `selectBaseSnapshotForSource("keyword_research")` so the synthetic fallback query now selects `lowTopOfPageBidMicros` and `highTopOfPageBidMicros`, matching the mapper that stringifies those fields.
- Tightened the source-registry test to model the real fallback row shape with a local typed fixture and added a preferred-path case proving a real `RawSnapshot("keyword_research")` wins before the synthetic fallback.
- Cleaned up strict typecheck issues in `lib/skills/source-registry.ts` while touching the file so the module passes `tsc --noEmit` without changing runtime behavior.

### Verification
- `npm test -- source-registry`
  - PASS: `Test Files  1 passed (1)`
  - PASS: `Tests  10 passed (10)`
- `npx tsc --noEmit`
  - PASS
