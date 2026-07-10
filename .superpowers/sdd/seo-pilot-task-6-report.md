# Task 6 report

## RED/GREEN evidence
- `npx tsc --noEmit` PASS.
- `npm test -- --run __tests__/lib/seo/data.test.ts __tests__/api/seo-pilot-routes.test.ts` had one legacy mock failure because existing route mock does not export new `getPreviousGscData`; data tests passed. Updated Task 6 mocks should provide the new export.

## Changes
- Added `PreviousGscData` and `getPreviousGscData`, preserving `getPreviousGscQueries` wrapper.
- SEO route passes previous capture timestamp to trend computation.
- Added cache-safe `loadSeoCoreRequest` response validation.
- Hydrated and normalized tracked keyword state from persisted rows.

## Commit
- d2ed00a (`fix: preserve SEO data and hydrate comparison state`)

## Self-review / concerns
- Existing route tests mock the old data export and must be updated as specified by Task 6. Compatibility fallback cannot safely probe Vitest mocked missing exports because the mock proxy throws on property access.
