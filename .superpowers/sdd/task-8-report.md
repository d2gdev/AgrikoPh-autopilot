# Task 8 Report: Dashboard "Outcome Win Rate (90d)" stat

## Status: DONE

## What was done

1. **`lib/dashboard/jobs-status.ts`**
   - Added `outcomeWinRate: { improved: number; worsened: number; total: number } | null;` to the `JobsStatusPayload` type.
   - In `buildJobsStatusPayload()`, added a query (right after the `dbLatencyMs` ping) fetching `recommendation.findMany({ where: { status: "executed", outcomeCheckedAt: { gte: ninetyDaysAgo } }, select: { outcome: true } })`, tallying `improved`/`worsened` verdicts from the JSON `outcome` field.
   - Added `outcomeWinRate` to the returned payload object: `null` when no rows are found in the 90-day window, otherwise `{ improved, worsened, total }`.
   - **Left the runtime payload validator (`isPayload`, ~line 122) untouched** — see judgment call below.

2. **`app/(embedded)/page.tsx`**
   - Added `outcomeWinRate: { improved: number; worsened: number; total: number } | null;` to the local `DashboardData` interface.
   - Added a fifth `<Card>` to the Operations row `StatGrid` (after "Last Job Run"): shows a rounded win-rate percentage plus an "N improved · N worsened · N checked" subline, or "No outcomes checked yet" when `outcomeWinRate` is null.
   - Bumped the Operations row's loading-skeleton count from four `<StatCardSkeleton />` to five to match.

## Judgment call: runtime payload validator

The brief flagged a decision point: should `"outcomeWinRate" in value` be added to `isPayload()` for consistency with the other required keys?

I read the actual validator (`lib/dashboard/jobs-status.ts` ~line 122-130):

```ts
function isPayload(value: unknown): value is JobsStatusPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      "pendingCount" in value &&
      "perJobHealth" in value &&
      "staleRunning" in value,
  );
}
```

It is **not** an exhaustive per-field check — `JobsStatusPayload` has ~19 fields, and the validator only spot-checks 3 of them (`pendingCount`, `perJobHealth`, `staleRunning`). It was never "enumerate every required key strictly," so the brief's stated precondition for adding the new field ("if it enumerates every required key strictly... add it too, for consistency") does not hold.

**Decision: left the validator unchanged, did not add `"outcomeWinRate" in value`.** Reasoning:
- Adding the new field wouldn't actually make the validator more consistent — it already omits 16 other fields, so partial coverage stays partial either way.
- Adding it *would* introduce a real regression: any `RawSnapshot` payload persisted before this deploy lacks `outcomeWinRate` and would suddenly fail `isPayload()`, forcing every dashboard load to treat a good cached snapshot as invalid and do a full rebuild until the next refresh — a real (if temporary) added DB/CPU load and staleness risk for zero validation benefit, since the validator wasn't guarding against missing `outcomeWinRate` in any meaningful way to begin with.
- Documented this reasoning in the commit message so it's visible in `git log`, not just in this report.

## Verification (Step 4)

- `npx tsc --noEmit` — clean, no errors.
- `npm test` — 113 test files, 695 tests, all passed. No test asserts on `outcomeWinRate` or needed fixture updates (the existing `jobs-status-v3.test.ts` fixture builder and mocks default `recommendation.findMany` to `[]`, which naturally yields `outcomeWinRate: null` and doesn't break any assertions since no test checks call counts on `recommendation.findMany`).
- `npm run build` — succeeded, no new route/type errors.

Self-reviewed the full diff (`git diff` before commit) — matches the brief's Step 1-3 snippets exactly, plus the deliberate validator omission.

## Commit

```
e706307 feat(dashboard): outcome win rate (90d) stat in the Operations row
```

Files changed: `lib/dashboard/jobs-status.ts`, `app/(embedded)/page.tsx`. Not pushed (per instructions — commit only).

## Files touched (absolute paths)

- `/home/sean/Agriko/auto-pilot/lib/dashboard/jobs-status.ts`
- `/home/sean/Agriko/auto-pilot/app/(embedded)/page.tsx`

## Google Ads Keyword Planner integration

Not touched. No files under `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, `skills-source/46-google-keyword-gap-analysis.md`, or any `GOOGLE_ADS_*` env var were modified.

---

# Task 8 Addendum: Organic priority evidence + source availability surfacing

## Status: DONE

## Implementation notes

1. **`app/api/growth-brief/route.ts`**
   - Added score-aware queue ordering via a shared comparator: normalized `priorityRank()` first, then descending score evidence (`ContentProposal.sourceData.organicPriority.score` where available, otherwise `Opportunity.score` / default `0`).
   - Added concise operator-facing evidence chips for organic work items: `Score N`, `Impact X`, `Effort Y`, followed by the existing type/source descriptors.
   - Added a `runSkills` data-quality block sourced from the latest `JobRun` for `jobName = "run-skills"`, exposing:
     - `status`
     - `completedAt`
     - `unavailableSources`
     - `unavailableSkillCount`
     - `unavailableSkillDetails` (first 3 missing/stale-source summaries)
   - This is read-only surfacing only. No generation logic, execution logic, ad writes, or source-registry behavior changed.

2. **`app/(embedded)/(insights)/growth-brief/page.tsx`**
   - Rendered the new run-skills source diagnostics inside the existing Data Quality card as badges plus concise detail lines.
   - Chose this location instead of creating a new section because the page already has a diagnostics surface there, and the task explicitly scoped this to operator-facing surfacing rather than a broader IA change.

3. **`__tests__/api/growth-brief-route.test.ts`**
   - Added route regression coverage for:
     - organic `ContentProposal` ordering within the same priority band by scorer evidence
     - `Opportunity` ordering within the same priority band by score
     - evidence-chip text inclusion
     - `run-skills` source-unavailable diagnostics exposure

## Exact command outputs

### Red phase

Command:

```bash
npm test -- growth-brief
```

Output:

```text
> agriko-autopilot@0.1.0 test
> vitest run growth-brief


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot

 ❯ __tests__/api/growth-brief-route.test.ts (1 test | 1 failed) 224ms
     × sorts operator queues by priority rank then score evidence and surfaces source diagnostics 221ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/api/growth-brief-route.test.ts > growth-brief route > sorts operator queues by priority rank then score evidence and surfaces source diagnostics
AssertionError: expected [ 'content:proposal-low', …(1) ] to deeply equal [ 'content:proposal-high', …(1) ]

- Expected
+ Received

  [
-   "content:proposal-high",
    "content:proposal-low",
+   "content:proposal-high",
  ]

 ❯ __tests__/api/growth-brief-route.test.ts:170:81
    168|
    169|     expect(res.status).toBe(200);
    170|     expect(body.sections.readyToApprove.map((item: { id: string }) => …
       |                                                                                 ^
    171|       "content:proposal-high",
    172|       "content:proposal-low",

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 5 passed (6)
   Start at  04:59:16
   Duration  664ms (transform 235ms, setup 0ms, import 264ms, tests 235ms, environment 0ms)
```

### Verification

Command:

```bash
npm test -- growth-brief
```

Output:

```text
> agriko-autopilot@0.1.0 test
> vitest run growth-brief


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  2 passed (2)
      Tests  6 passed (6)
   Start at  05:01:08
   Duration  769ms (transform 390ms, setup 0ms, import 392ms, tests 279ms, environment 0ms)
```

Command:

```bash
npm test -- seo
```

Output:

```text
> agriko-autopilot@0.1.0 test
> vitest run seo


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  10 passed (10)
      Tests  77 passed (77)
   Start at  05:00:34
   Duration  7.39s (transform 5.29s, setup 0ms, import 5.25s, tests 6.25s, environment 2ms)
```

Command:

```bash
npm test -- content-pilot
```

Output:

```text
> agriko-autopilot@0.1.0 test
> vitest run content-pilot


 RUN  v4.1.8 /home/sean/Agriko/auto-pilot


 Test Files  9 passed (9)
      Tests  58 passed (58)
   Start at  05:00:34
   Duration  7.80s (transform 4.70s, setup 0ms, import 10.32s, tests 1.84s, environment 33ms)
```

Command:

```bash
npx tsc --noEmit
```

Output:

```text
(no output; exited 0)
```

---

# Task 8 Review Fix Addendum: queue overfetch + preserved scorer priority

## Status: DONE

## What changed

1. **`app/api/growth-brief/route.ts`**
   - Added bounded queue overfetch constants and changed the `contentProposal.findMany()` / `opportunity.findMany()` reads to fetch more than the operator-visible limit before the final in-memory ranking trim.
   - Kept the final operator-facing queue limit unchanged; only the selection pool widened so top items are chosen by Growth Brief rank rather than by the database pre-slice.
   - Added `sortPriority` to `BriefItem` and changed queue comparison to rank on `sortPriority` first, then score.
   - For organic content proposals, `sortPriority` now prefers `sourceData.organicPriority.priority` when present, while the existing `priority` field remains unchanged for UI compatibility.
   - No generation logic, live execution behavior, Google Ads writes, or run-skills/source diagnostics were changed.

2. **`__tests__/api/growth-brief-route.test.ts`**
   - Added a regression that simulates a DB honoring `take` before route sorting and proves the route must overfetch proposals/opportunities to select the correct top queue items.
   - Added a regression that proves a preserved scorer `P0` in `sourceData.organicPriority.priority` outranks a clamped `P1` proposal even when the clamped item has the higher score.
   - Kept the existing same-band score/detail diagnostic coverage.

## Exact verification

- `npm test -- growth-brief` — passed
- `npm test -- seo` — passed
- `npm test -- content-pilot` — passed
- `npx tsc --noEmit` — passed
