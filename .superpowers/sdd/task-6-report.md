# Task 6 Report: ROUTER, final gate, push (Phase 8b dashboard split)

## Status: DONE

## 1. ROUTER.md diff

`last_updated` bumped: `2026-07-04T20:15:00Z` → `2026-07-04T22:30:00Z`

New bullet added at the top of "Current Project State" → "Working" (before the Shopify Orders Ingestion bullet):

```diff
diff --git a/.mex/ROUTER.md b/.mex/ROUTER.md
--- a/.mex/ROUTER.md
+++ b/.mex/ROUTER.md
@@ -18,7 +18,7 @@ edges:
   - target: patterns/INDEX.md
     condition: when starting a task — check the pattern index for a matching pattern file
-last_updated: 2026-07-04T20:15:00Z
+last_updated: 2026-07-04T22:30:00Z
 ---
@@ -30,6 +30,7 @@
 **Working:**
+- **Dashboard page split (Phase 8b, 2026-07-04)**: `app/(embedded)/page.tsx` reduced from 1,478 to 215 lines by extracting co-located, non-route helper files under `app/(embedded)/components/dashboard/`: `types.ts` (verbatim `JobsStatusPayload` contract move), `helpers.tsx`, `Sparkline.tsx`, `JobHealth.tsx`, `InsightCards.tsx`, `useDashboardData.ts`, plus nine props-only section components under `dashboard/sections/`: `StaleAlertBanner.tsx`, `PendingRecInbox.tsx` (kept in its inviolable lead position), `OperationsRow.tsx`, `PerformanceRow.tsx`, `IntelRow.tsx`, `SkillInsightsSection.tsx`, `JobHealthSection.tsx`, `TrendsSection.tsx`, `RecentActivity.tsx` — page state stays lifted in `page.tsx`. Reused the Phase 8a zero-behavior-change protocol: verbatim moves only, an exhaustive permitted-edit list, an action-inventory table, and hook-count invariance confirmed exactly equal under both a naive and a generic-aware grep pattern. Phase 9 fold-in for this page: all 15 hardcoded hex colors (`stalenessStyle`, `STATUS_DOT_COLOR`, sparkline colors, etc.) replaced with Polaris design tokens — a full zero-raw-hex sweep across `dashboard/` confirms none remain (3 of the 15 initially slipped through across the extraction tasks and were caught and closed by Task 5's own verification pass); the emoji caret in `JobHealth.tsx`'s JobRow was replaced with Polaris `ChevronUpIcon`/`ChevronDownIcon`. The roadmap's other two named offenders for this page — TrendDots' color-only status dots and the caret's keyboard-operability — were checked against the original pre-phase commit and found to already satisfy the a11y requirement (text channel / keyboard operable), so no new work was needed there.
 - **Shopify Orders Ingestion (Phase 4, 2026-07-04, docs/gate done — deploy pending operator go-ahead)**: ...
```

Note: the task brief referenced `components/dashboard/...` paths; the real location on disk is `app/(embedded)/components/dashboard/...` (a non-route folder inside the `(embedded)` group root). Verified directly against the filesystem before writing the bullet; all 15 named files (types.ts, helpers.tsx, Sparkline.tsx, JobHealth.tsx, InsightCards.tsx, useDashboardData.ts, and the 9 files under sections/) exist and match.

## 2. Final gate output

### `npx tsc --noEmit`
```
TypeScript: No errors found
```
Clean.

### `npm test`
```
 RUN  v4.1.8 /home/sean/Agriko/auto-pilot
 Test Files  121 passed (121)
      Tests  741 passed (741)
   Duration  11.17s (transform 4.35s, setup 0ms, import 10.40s, tests 3.64s, environment 14ms)
```
All 741 tests across 121 files passed, no failures/skips.

### `npm run build`
Clean production build (`✓ Compiled successfully in 10.3s`). Dashboard route `/` confirmed present and building as a static page:
```
┌ ○ /                                                          16 kB         169 kB
```
(16 kB route bundle, 169 kB First Load JS.)

## 3. Pre-commit verification

- Confirmed all 15 co-located files exist at `app/(embedded)/components/dashboard/` and `app/(embedded)/components/dashboard/sections/` matching the brief's file list.
- Zero-raw-hex sweep: `rtk grep -n "#[0-9a-fA-F]\{3,6\}" "app/(embedded)/components/dashboard" -r` → 0 matches.
- Caret→icon swap confirmed: `JobHealth.tsx` imports `ChevronUpIcon, ChevronDownIcon` from `@shopify/polaris-icons` (line 13) and uses them in the JobRow disclosure (line 100) — no emoji caret remains.

## 4. Commit + push

```
git add .mex/ROUTER.md
git commit -m "docs(mex): record Phase 8b dashboard split"
git push origin main
```

- Commit created: `30dd891`
- 1 file changed, 2 insertions(+), 1 deletion(-)
- Push result: `e7c59a9..30dd891  main -> main`

## Deviations

One documentation correction: the brief described the new files as living under `components/dashboard/...`; they actually live under `app/(embedded)/components/dashboard/...`. The ROUTER bullet uses the real path and calls this out so it isn't misleading to future readers. No other deviations — gate ran clean on the first pass, no speculative fixes needed, and only `.mex/ROUTER.md` was staged/committed (verified nothing else was touched). Google Ads Keyword Planner files were not touched by this doc-only task.

---

# Task 6 Report: deterministic organic prioritization scorer

## Status: DONE

## Implementation notes

- Added `lib/organic/prioritization.ts` as a pure deterministic scorer with no LLM inputs, side effects, connector calls, or execution-path changes.
- Added `__tests__/lib/organic/prioritization.test.ts` with the exact red-phase cases from the task brief:
  - high-impression CTR gaps outrank low-volume metadata fixes
  - stale data plus high effort reduces score versus fresher lower-effort work
- Kept the scoring surface limited to typed inputs/outputs and component-level score breakdowns for explainability in later consumers.

## TDD evidence

### RED — `npm test -- organic/prioritization`
```text
> agriko-autopilot@0.1.0 test
> vitest run organic/prioritization


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot
 ❯ __tests__/lib/organic/prioritization.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/lib/organic/prioritization.test.ts [ __tests__/lib/organic/prioritization.test.ts ]
Error: Cannot find package '@/lib/organic/prioritization' imported from /home/sean/Agriko/auto-pilot/__tests__/lib/organic/prioritization.test.ts
 ❯ __tests__/lib/organic/prioritization.test.ts:3:1
      1| import { describe, expect, it } from "vitest";
      2|
      3| import { scoreOrganicOpportunity } from "@/lib/organic/prioritization";
       | ^
      4|
      5| describe("scoreOrganicOpportunity", () => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  04:39:17
   Duration  728ms (transform 124ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)
```

### GREEN — `npm test -- organic/prioritization`
```text
> agriko-autopilot@0.1.0 test
> vitest run organic/prioritization


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  04:39:52
   Duration  483ms (transform 111ms, setup 0ms, import 156ms, tests 10ms, environment 0ms)
```

### Typecheck — `npx tsc --noEmit`
```text
(no stdout; exit 0)
```
