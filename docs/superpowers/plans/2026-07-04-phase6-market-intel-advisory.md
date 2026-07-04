# Phase 6 — Market Intelligence → Advisory Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market intelligence stops being noisy and starts being advisory: price-gap insights are computed from a de-noised 7-day median signal that must persist 14+ days (instead of a single day's scrape), competitor keyword gaps seed ContentProposals, and a competitor whose ad capture silently flatlines (the Falo problem) raises an operator alert plus a persistent fix-it StoreTask.

**Architecture — scope corrections from fact-finding (read first):**
1. **The price-gap → StoreTask chain already exists end-to-end**: `jobs/fetch-market-intel.ts` (~line 650) already does own-catalog matching (cheapest variant vs competitor ShoppingResults, >10% gap) → `price_gap` MarketInsight (open-insight dedup) → `opportunityFromMarketInsight` maps it to type `"market_insight"` → `shouldRouteOpportunityToStoreTask` routes that type → `upsertStoreTasksFromOpportunities` upserts the StoreTask. **Phase 6 does not build this chain; it fixes its input**: the comparison today uses a *single capture day's* prices, exactly the noise the roadmap worries about. The new de-noising layer replaces the comparison source, and the persistence gate ("stable for 14+ days") is added at the insight producer.
2. **`keyword_gap` MarketInsights have a producer but NO consumer** (grep-verified: only `jobs/fetch-market-intel.ts` references the type). The roadmap's "extend the existing keyword_gap consumer" points at nothing — the consumer is *created* here, inside `generateProposals` per the Phase 3 lesson (the daily cron deletes + regenerates all pending proposals nightly; open `MarketInsight` rows are the durable source to regenerate from).
3. **Zero-capture detection has the data it needs**: `CompetitorAdCapture` rows carry `competitorId` + `jobRunId`, so "0 ads for 7+ consecutive runs" is a query over the last 7 completed `fetch-market-intel` runs. `CompetitorSocialPage.pageId` is nullable — the Falo failure mode is a page configured by name/URL without the numeric page ID, which scrapes zero silently.
4. **Thresholds**: `getThresholds()` in `lib/guardrails.ts` is module-private with a fixed executor-centric type — do NOT extend it. Price-signal thresholds are read as `GuardrailConfig` rows directly where consumed (`PRICE_GAP_TASK_PCT` default 10, `PRICE_GAP_MIN_DAYS` default 14, `PRICE_OUTLIER_PCT` default 40), same key/value table, no schema change.

**Tech Stack:** Next.js 14 App Router, Prisma/PostgreSQL, Vitest. No migration, no new dependencies.

## Global Constraints

- **Keyword Planner is untouchable** (user directive, clarified 2026-07-03: the "no Google Ads" ban covers advertising only, never keyword research). Nothing here touches `lib/connectors/google-ads.ts`, `jobs/fetch-keyword-research.ts`, the `google_ads_keyword_research` connector-health entry, `GOOGLE_ADS_*` env vars, or skill 46. **`keyword_gap` MarketInsights come from DataForSEO Labs — a separate, legitimate organic-data source; both data sources stay.** If any step appears to require touching the Keyword Planner surface, stop and surface to the operator.
- **ADVISORY ONLY (roadmap-locked, explicitly resolved scope question):** price gaps create StoreTask rows; **no code path may change a price, anywhere, under any flag**. If a task appears to need a price write, stop and surface.
- `lib/market-intel/price-signal.ts` is **pure functions only** — no prisma, no I/O — unit-tested against fixture series.
- The ContentProposal seed producer lives **inside `generateProposals`** (Phase 3 lesson: nightly delete+regenerate of pending proposals wipes standalone producers). Follow the Phase 3 competitor-seed pattern exactly (findings appended before the dedup pass, `proposedState.targetKeyword` set as the dedup discriminator).
- `OperatorAlertKind` gains one member — an **additive** union change; the Phase 1 no-throw/no-op-when-unset contract of `sendOperatorAlert` is untouched.
- All DB access via `import { prisma } from "@/lib/db"`. Verify gate: `npx tsc --noEmit` clean, `npm test` green, `npm run build` clean.
- After the phase: update `.mex/ROUTER.md`, commit + push. **No deploy checkpoint** (next 🚀 is after Phase 7).

---

### Task 1: `lib/market-intel/price-signal.ts` — pure de-noising functions

**Files:**
- Create: `lib/market-intel/price-signal.ts`
- Test: `lib/market-intel/__tests__/price-signal.test.ts` (note: market-intel tests live in `lib/market-intel/__tests__/`, not `__tests__/lib/` — follow the existing `spam-filter.test.ts` precedent)

**Interfaces:**
- `type PricePoint = { price: number; capturedAt: Date }`
- `smoothedMedian(series: PricePoint[], opts: { windowDays: number; outlierPct: number; asOf: Date }): number | null` — takes the points within `windowDays` before `asOf`, rejects points deviating more than `outlierPct`% from the raw median of the window, returns the median of survivors; `null` when fewer than 2 in-window points survive (a single capture is exactly the noise we refuse to act on).
- `gapIsStable(input: { ownPrice: number; series: PricePoint[]; gapPct: number; minDays: number; windowDays: number; outlierPct: number; asOf: Date }): { stable: boolean; smoothed: number | null; gapPctNow: number | null; daysStable: number }` — computes the smoothed median as of each of the trailing `minDays` day-marks; `stable` only when every day-mark with a computable median showed `((ownPrice - smoothed) / ownPrice) * 100 > gapPct` AND at least `minDays - 2` day-marks were computable (tolerates up to 2 missing capture days).

- [ ] **Step 1: Write the failing tests** — fixture series covering: clean stable gap (14 days of competitor ~₱200 vs own ₱300 → stable true); single-day spike to ₱600 rejected by the ±40% outlier rule (median unmoved); a gap that only appeared 5 days ago → stable false with `daysStable` ≈ 5; empty/one-point series → smoothed null, stable false; boundary: exactly `gapPct` is NOT a gap (strict `>`).

- [ ] **Step 2–4: Implement (pure, no imports beyond types), PASS, commit** — `feat(market-intel): pure price-signal smoothing (7d median, outlier rejection, stability gate)`.

---

### Task 2: De-noise the price-gap producer in `jobs/fetch-market-intel.ts`

**Files:**
- Modify: `jobs/fetch-market-intel.ts` (the own-catalog price-gap block only, ~lines 650–735)
- Test: extend the price-gap coverage in `__tests__/jobs/fetch-market-intel-price-gap.test.ts` (13.3K of existing tests — read its fixture style first)

- [ ] **Step 1: Read the full price-gap block and the existing test file first.** Then change the comparison source: instead of comparing `ownPrice` against each of today's `ShoppingResult` rows directly, group the day's results by `store`, and for each store load that product-match's trailing price series from `ShoppingPriceHistory` (`where: { productKey, capturedAt: { gte: asOf − (windowDays + minDays) days } }`, select `price, capturedAt`) and call `gapIsStable`. Create the `price_gap` MarketInsight **only when `stable` is true**, and extend `evidence` with `{ smoothedPrice, daysStable, thresholds: { gapPct, minDays, outlierPct } }` alongside the existing fields. The existing open-insight dedup stays exactly as is (it is what makes the StoreTask idempotent downstream).

- [ ] **Step 2: Threshold config.** At the top of the price-gap step, read the three keys in one query with defaults:

```typescript
const cfg = Object.fromEntries((await prisma.guardrailConfig.findMany({
  where: { key: { in: ["PRICE_GAP_TASK_PCT", "PRICE_GAP_MIN_DAYS", "PRICE_OUTLIER_PCT"] } },
})).map((c) => [c.key, Number(c.value)]));
const gapPct = cfg.PRICE_GAP_TASK_PCT ?? 10;
const minDays = cfg.PRICE_GAP_MIN_DAYS ?? 14;
const outlierPct = cfg.PRICE_OUTLIER_PCT ?? 40;
```

(Verify the `GuardrailConfig` model's field names — `key`/`value` — against the schema before writing; `getThresholds` in guardrails.ts reads them this way.)

- [ ] **Step 3: Update the insight title/summary** to reflect the advisory framing the roadmap locked: `Review pricing for {product}: {store} at ₱X (7d median) vs ours ₱Y for {daysStable}+ days`.

- [ ] **Step 4: Tests.** Extend the price-gap test file: a fixture where today's single capture shows a gap but history doesn't → no insight; a fixture with 14 days of stable-gap history → exactly one insight with `smoothedPrice` in evidence; second run same day → no duplicate (existing dedup assertion style). Run the full file + `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(market-intel): price-gap insights require a stable 14-day smoothed gap, not a single-day scrape`.

---

### Task 3: keyword_gap MarketInsights → ContentProposal seeds

**Files:**
- Modify: `lib/content-pilot/generate-proposals.ts`
- Test: extend `__tests__/lib/content-pilot/generate-proposals.test.ts`

- [ ] **Step 1: Read Phase 3's competitor-seed implementation in this file first** (the `skillInsight.findFirst` in the initial `Promise.all`, the builder, the append-before-dedup, the per-run cap) — this task is its sibling. Add to the `Promise.all`: `prismaClient.marketInsight.findMany({ where: { type: "keyword_gap", status: "open" }, orderBy: { createdAt: "desc" }, take: 12 })`. Builder maps each insight's evidence (`{ keyword, competitorDomain, competitorPosition, searchVolume }` — shape confirmed at the producer, fetch-market-intel ~line 865) to a ProposalInput:
  - `articleHandle: null`, `proposalType: "new-content"`, `changeType: "new_article"`, `priority` from searchVolume (≥1000 → "high", else "medium"), house-style `impact`/`effort`
  - `title: 'Keyword gap: "<keyword>" (<competitorDomain> ranks #<position>)'` (≤240 chars)
  - `proposedState: { targetKeyword: keyword, angle: ..., competitorDomain, searchVolume }` — `targetKeyword` is load-bearing for the null-handle dedup discriminator
  - `sourceData: { marketInsightId, competitorId, evidence subset }`
  - Cap: 6 keyword-gap seeds per run; skip malformed evidence defensively.

- [ ] **Step 2: Tests** — mocked open keyword_gap insights yield seeds with distinct `targetKeyword`s; `findMany → []` yields zero and leaves other sources untouched; malformed evidence skipped. Mirror the Phase 3 competitor-seed test block.

- [ ] **Step 3: Commit** — `feat(content-pilot): keyword_gap market insights seed new-content proposals`.

---

### Task 4: Zero-capture watchdog — operator alert + persistent StoreTask

**Files:**
- Modify: `lib/alerts.ts` (union member only), `jobs/fetch-market-intel.ts` (new step at the end of the ad-capture section)
- Test: `__tests__/jobs/fetch-market-intel-zero-capture.test.ts` (new; mock style per the existing market-intel test files)

- [ ] **Step 1: Additive union member** in `lib/alerts.ts`: add `| "competitor_zero_capture"` to `OperatorAlertKind`. Nothing else changes (the wrapper is kind-agnostic).

- [ ] **Step 2: Detection step** in `jobs/fetch-market-intel.ts`, after the ad-capture loop completes (read the section boundaries first):

1. Load the last 7 completed `fetch-market-intel` JobRun ids **before this run** (`where: { jobName: "fetch-market-intel", status: { in: ["success", "partial"] }, id: { not: runId } }, orderBy: { completedAt: "desc" }, take: 7`). Require exactly 7 — fewer means not enough history, skip silently.
2. For each **active** competitor that has at least one **active** social page: count `CompetitorAdCapture` rows `where: { competitorId, jobRunId: { in: runIds } }`, and count captures for **this** run. If historical count is 0 AND this run's count is 0 AND the competitor has ever had a capture at all OR any of its pages is missing `pageId` — flag it. (The `pageId`-missing OR-branch is what catches Falo-type never-worked configs; the ever-had-a-capture branch catches breakage of previously-working pages.)
3. For each flagged competitor: `storeTask.upsert` with `dedupeKey: 'store-task:zero-capture:<competitorId>'`, `taskType: "fix_competitor_page"`, `targetType: "competitor"`, `priority: "high"`, title `Ad capture broken for <name> — verify the Facebook numeric page ID`, description telling the operator to pull the numeric page ID from Facebook's Page Transparency panel and set it on the competitor's social page. **Send `sendOperatorAlert("competitor_zero_capture", { competitorId, competitorName, consecutiveRuns: 8 })` only when the task did not already exist** (do `storeTask.findUnique({ where: { dedupeKey } })` first; alert on create only — the job runs daily and must not re-alert an already-flagged competitor).
4. Add `zeroCaptureCompetitors: number` to the job summary.

- [ ] **Step 3: Tests** — flagged competitor (7 zero runs + zero this run + missing pageId) → one StoreTask upsert + one alert; already-existing task → upsert but NO alert; competitor with captures in any of the 7 runs → nothing; fewer than 7 historical runs → nothing. Run the new file plus the existing market-intel suites.

- [ ] **Step 4: Commit** — `feat(market-intel): zero-capture watchdog — operator alert + persistent fix-it StoreTask`.

---

### Task 5: Surface the smoothed signal on the Market Intelligence page

**Files:**
- Modify: the price-comparison data path + `PriceComparisonCard` render (locate first — the component is imported at `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx:35`; find its file and the API route that feeds it before editing)

- [ ] **Step 1: Read first**: the `PriceComparisonCard` component, where its data comes from (page fetch → which `/api/market-intelligence*` route), and what per-product fields it renders. Then make the **smallest additive change** that shows the de-noised signal: the API adds a `smoothed7d: number | null` per compared product (computed via `smoothedMedian` over the same `ShoppingPriceHistory` series the card's data already implies — reuse, don't duplicate, whatever query feeds it), and the card renders it as a subdued `7d median ₱X` line next to the current price when non-null. If a price-gap StoreTask exists for the product/store pair (`storeTask.findMany` on the relevant dedupe/target fields — check what Task 2's chain produces via the opportunity router), show a small `Review pricing` badge linking to the store-tasks surface; if that linkage turns out not to be cheaply resolvable, render the median only and note the skipped link in the report rather than building a lookup table.

- [ ] **Step 2: Verify + commit** — `npx tsc --noEmit`, `npm run build` clean. `feat(market-intel): show 7-day smoothed median on the price comparison card`.

---

### Task 6: ROUTER, final gate, push

**Files:**
- Modify: `.mex/ROUTER.md`

- [ ] **Step 1: ROUTER bullet** (bump `last_updated`): price-gap insights now gated on `lib/market-intel/price-signal.ts` (7d median, ±40% outlier rejection, 14-day stability; thresholds = GuardrailConfig keys PRICE_GAP_TASK_PCT/PRICE_GAP_MIN_DAYS/PRICE_OUTLIER_PCT with 10/14/40 defaults); keyword_gap MarketInsights seed new-content ContentProposals inside generateProposals (they previously had NO consumer); zero-capture watchdog (7 consecutive empty runs → `competitor_zero_capture` alert once + persistent `fix_competitor_page` StoreTask — the Falo fix); advisory-only invariant restated (no price writes exist anywhere).

- [ ] **Step 2: Final gate + push**

Run: `npx tsc --noEmit`, `npm test` (record counts), `npm run build` — clean/green.

```bash
git add .mex/ROUTER.md
git commit -m "docs(mex): record Phase 6 market-intel advisory layer"
git push origin main
```

Acceptance (roadmap, all test-verifiable): fixture price series with noise produces a stable signal (Task 1 tests); a persistent gap creates exactly one StoreTask — idempotent (Task 2's open-insight dedup + the pre-existing opportunity/StoreTask dedupe chain, asserted at the insight level); a zero-capture competitor triggers an operator alert (Task 4 tests).

---

## Self-review notes

- Roadmap coverage: de-noising layer in the exact file the roadmap named, pure + fixture-tested (Task 1); advisory StoreTasks via the *existing* insight→opportunity→task chain with the noise fixed at the producer (Task 2 — the roadmap thought the chain needed building; it needed better input); keyword gaps → ContentProposal seeds (Task 3, consumer created since none existed, Phase 3 survival pattern followed); Falo fix as persistent StoreTask + zero-capture alert via Phase 1's transport with an additive union member (Task 4); page surfacing (Task 5); acceptance criteria mapped to specific tests (Task 6). ✔
- Contradictions documented in Architecture: chain-already-exists, consumer-doesn't-exist, thresholds live in GuardrailConfig rows not getThresholds, zero-capture data model confirmed.
- Safety: advisory-only stated twice (constraints + acceptance); no migration; alert spam prevented by alert-on-create-only; smoothing never *widens* detection (a stable-gate can only reduce insight volume vs today).
- No placeholders: interfaces are exact; the five read-before-edit spots (price-gap block, price-gap test fixture style, Phase 3 seed pattern, ad-capture section boundary, PriceComparisonCard data path) name what to look for; Task 5 has an explicit fallback decision rule instead of an open-ended "figure it out".
- Type consistency: `PricePoint`/`gapIsStable` shapes identical between module, tests, and the Task 2 call site; the GuardrailConfig key names identical across Task 2, ROUTER, and evidence payload; `competitor_zero_capture` kind identical in union, call site, and tests.
- Keyword Planner surface untouched; DataForSEO Labs keyword_gap source explicitly distinguished and preserved.
