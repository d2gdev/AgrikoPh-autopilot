# Task 4 report

Status: DONE

## Delivered

- Added client-safe active-map, analysis-envelope, and discriminated loading/no-map/error/stale/empty/ready state types.
- Added an ordered loader that fetches command-center identity before requesting cached analysis.
- Added a second client-side version ID and package hash match before analysis is accepted.
- Wired `mapState`, `mapAnalysisState`, and `reloadCommandCenter` into `useSeoData`; refresh uses the same identity-first order.
- Governance failure and no-active-map paths do not request or expose prior analysis.

## TDD evidence

- RED: `npm test -- __tests__/components/use-seo-data.test.ts` — 4 expected failures because `resolveMapAnalysisState` and `loadCommandCenterAndAnalysis` did not exist.
- GREEN: `npm test -- __tests__/components/use-seo-data.test.ts __tests__/components/seo-pilot-responsive.test.ts` — 2 files, 18 tests passed.
- Type gate: `npm run typecheck` — passed.
- Diff hygiene: `git diff --check` — passed.

## GROW / concerns

- Ground: SEO Pilot now owns one coherent, identity-bound active-map state suitable for Task 5 controls.
- Record: this report records the new client boundary; no architecture fact or reusable runbook changed.
- Orient: existing topical-map operator-surface patterns remain applicable; no new recurring procedure was introduced.
- Write: no scaffold/context file required a factual update.
- Concerns: none.

## Review fixes

- The analysis route now distinguishes `ready`, `empty`, `stale`, and `no_active_strategy`. For stale schema-v2 snapshots it returns the current and cached identities but always returns `analysis: null`; stale finding content never crosses the server boundary.
- The client maps the exact stale route response to `MapAnalysisState.stale` while retaining the command-center-first request order.
- Successful command-center responses are strictly discriminated: only an exact `no_active_strategy` null payload or a complete `ready` payload is accepted. Unknown future states and malformed ready payloads become governance errors and do not trigger analysis loading.

### Review-fix RED

`npm test -- __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts` failed 4/53 as expected: the route omitted the stale discriminator and cached identity, the client mapped stale to empty, and malformed governance payloads mapped to no-active-strategy.

### Review-fix GREEN

- Same focused command: 2 files, 53/53 tests passed.
- `npm run typecheck`: passed.
- Targeted ESLint across the two tests and four changed production files: passed with exit 0.
- `git diff --check`: passed with exit 0.

## Final review fixes

- Added an explicit runtime command-center guard requiring the complete active identity, all eleven numeric domain counts, projection arrays, work arrays, blocker arrays, and provenance object. A truthy identity-only object is rejected as a governance error before `/api/seo/analysis` is requested.
- Replaced the permissive analysis-envelope shape with an exact discriminated union for `ready`, `empty`, `stale`, and `no_active_strategy` and added a matching runtime guard. Impossible combinations such as ready/null or stale/non-null are rejected.

### Final RED/GREEN evidence

- RED: focused hook test failed 2/16 because the incomplete command center reached the analysis fetch and the envelope guard did not exist.
- GREEN: `npm test -- __tests__/components/use-seo-data.test.ts __tests__/api/seo-pilot-routes.test.ts` passed 55/55 tests.
- `npm run typecheck`, targeted ESLint, and `git diff --check` all passed with exit 0.
