# Data Maximization Plan — 2026-07-02

Goal: wire the data the plugin already collects into the AI recommendation engine, fix pipeline defects wasting existing capacity, and close the loop on whether executed recommendations work.

## Global Constraints

- All DB access via `import { prisma } from "@/lib/db"` — never instantiate PrismaClient directly.
- Every cron route: `requireCronAuth(req)` (sync) first, then `acquireJobLock` / `releaseJobLock` in try/finally.
- `pause_ad` must NEVER be added to `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts` and must always remain executable.
- No local dev DB exists: NEVER run `npm run db:migrate` or `prisma migrate dev`. Schema changes = edit `prisma/schema.prisma` + hand-write a migration folder `prisma/migrations/<timestamp>_<name>/migration.sql` (follow `20260702000000_add_ad_approval_workflow` as the example). Run `npm run db:generate` to regenerate the client. Applying migrations is deferred-to-human.
- Skills are markdown in `skills-source/` with YAML frontmatter; never hard-code skill prompts in TypeScript.
- All AI calls go through `getAiClient()` from `lib/ai/client.ts`.
- Tests: vitest (`npm test`). New logic needs unit tests. Tests must not require a live DB — mock prisma as existing tests do (see `__tests__/`).
- Verify with: `npm test`, `npm run lint`, `npm run build` (or `npx tsc --noEmit` for speed during iteration; full build at the end).
- Token discipline for shell: use `rtk grep`, `rtk ls`, `rtk find`, `rtk git log/diff` instead of bare grep/ls/find/git log/diff.
- Work directly on `main`; commit per task with conventional-commit messages ending in `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do NOT push (controller pushes at the end).

## Task 1: Fix skill rotation starvation + generation-time action filtering

**Problem A:** `jobs/run-skills.ts` caps at `MAX_SKILLS_PER_RUN = 30` and sorts by a `lastRunAt` field that never exists on `SkillDefinition` (lines 87–95) — every skill sorts to 0, so the same first 30 eligible skills run every day; the rest never run.

**Fix A:** Persist per-skill last-run timestamps in the JobRun summary, mirroring the existing `skillHashes` mechanism:
- After a run, store `skillLastRun: Record<skillId, ISO string>` in the summary for every skill that was dispatched this run (executed OR hash-skipped both count as "ran"), merged over the previous run's map (same merge semantics as `skillHashes`).
- When selecting: read `skillLastRun` from the last successful/partial run (same query as `lastSkillHashes`), sort eligible skills ascending by their timestamp (missing → 0, runs first), then slice to cap. This makes the round-robin real.

**Problem B:** Skills generate `change_bid` / `add_negative_keyword` recs (never executable on Meta) and all google_ads recs are dead on arrival (`lib/executor.ts` `SUPPORTED_ACTIONS.google_ads = []`). Operators approve them; execution then fails.

**Fix B:** Filter at generation time in `jobs/run-skills.ts`'s rec-persistence loop (around line 142, where `platform` is already derived):
- Export `SUPPORTED_ACTIONS` (or an `isSupportedAction` re-use) from `lib/executor.ts` — it already exists; import `isSupportedAction` into run-skills.
- Skip (do not persist) any rec where `!isSupportedAction(platform, rec.actionType)`. Count skipped recs and include `unsupportedSkipped` in the job summary. `console.warn` one aggregate line per skill.
- IMPORTANT: this must not silently drop insight value — the skill's narrative/insight output is unaffected; only non-executable Recommendation rows are suppressed.

**Tests:** unit tests for (a) rotation ordering: given a skillLastRun map and >cap eligible skills, the least-recently-run are selected; (b) unsupported actions are not persisted while supported ones are; (c) `pause_ad` on meta always passes the filter.

## Task 2: Multi-source skill payloads + market context injection

Skills currently receive ONLY the meta or google_ads snapshot (`jobs/run-skills.ts` `snapshotForSkill`, `lib/skills/runner.ts` `assembleDataPayload`). GSC, GA4, market-intel, and keyword-research data never reach any skill.

**Spec:**
1. `lib/skills/loader.ts`: parse optional frontmatter `metadata.extraSources: string[]` into `SkillDefinition.extraSources?: string[]`. Valid values: `"gsc"`, `"ga4"`, `"market_intel"`, `"keyword_research"`. Unknown values: warn and ignore.
2. New module `lib/skills/extra-context.ts` with `buildExtraContext(sources: string[]): Promise<Record<string, unknown>>` that loads, per source (all queries read-only, latest-window, size-capped):
   - `gsc`: latest `RawSnapshot` where source `"gsc"` (fall back to `"gsc_query_page"` if absent) — top 100 queries by clicks (trim payload; do not pass the raw blob wholesale).
   - `ga4`: latest `RawSnapshot` source `"ga4"` — top 50 landing pages by sessions with conversions/bounce.
   - `market_intel`: compact block from live tables: active `CompetitorAd` rows from the last 30 days (max 30: competitor, headline, adCopy truncated to 200 chars, cta, startDate, activeStatus), `ShoppingPriceHistory` changes from the last 14 days (max 20), open `MarketInsight` rows (max 10: type, severity, title, summary).
   - `keyword_research`: latest `KeywordResearchResult` rows (max 50: keyword, avgMonthlySearches, competition, top-of-page bid range).
3. `jobs/run-skills.ts`: compute the union of extraSources across applicable skills once per run, build the context once, and pass the per-skill subset into `runSkill(skill, snapshot, extraContext)`.
4. `lib/skills/runner.ts` `assembleDataPayload`: append one markdown section per extra source (e.g. `## Organic Search (GSC)`, `## Site Analytics (GA4)`, `## Market Intelligence`, `## Keyword Research`) with JSON blocks, AFTER the existing ad-data sections. Cap each section's JSON at ~8000 chars (truncate array, note truncation).
5. Wire existing skills via frontmatter only (no prompt rewrites needed beyond a sentence telling the skill the extra data exists):
   - `13-meta-competitor-creative-analysis.md` → `extraSources: [market_intel]`
   - `07-google-search-term-mining.md` → `extraSources: [keyword_research]`
   - `10-google-and-meta-landing-page-audit.md` → `extraSources: [ga4]`
6. Skill hash semantics: extra context must NOT break the hash-skip logic — hash remains based on the ad snapshot only (acceptable: extra context is advisory).

**Tests:** loader parses extraSources (valid, missing, unknown values); `buildExtraContext` returns expected shapes with mocked prisma; `assembleDataPayload` includes sections only for requested sources and truncates oversized arrays.

## Task 3: New cross-source skills (paid↔organic, keyword gap)

Two new skill markdown files (follow the format of existing `skills-source/*.md` — check `01-google-and-meta-cpa-diagnostics.md` for frontmatter shape):

1. `skills-source/45-google-and-meta-paid-organic-overlap.md` — platform "Google & Meta", `extraSources: [gsc, ga4]`. Prompt: cross-reference paid campaigns/keywords/ads with GSC organic rankings and GA4 landing-page behavior. Identify: (a) paid keywords/terms where the site already ranks top-5 organically (wasted spend), (b) ad landing pages with high GA4 bounce/low conversion, (c) organic winners with no paid support. Emit recommendations ONLY with actionTypes `pause_ad`, `pause_campaign`, `adjust_budget` (the executable set); everything else goes in the narrative. Modest confidenceScores when organic data is thin (known GSC density issue).
2. `skills-source/46-google-keyword-gap-analysis.md` — platform "Google", `extraSources: [keyword_research, gsc]`. Prompt: compare keyword-research volume/bid data against current paid keywords and GSC queries; surface high-volume keywords with no paid or organic presence, and low-volume keywords eating budget. Executable actionTypes only; opportunities in narrative.

Both files: `enabled: true`, description, and a note in the prompt that recommendations MUST use only supported action types (`pause_campaign`, `pause_ad`, `adjust_budget`).

**Tests:** loader picks up both files with correct platform + extraSources (filesystem-based load test like any existing loader test).

## Task 4: Outcome feedback loop (did the recommendation work?)

Nothing measures whether executed recommendations helped. Build the measurement job.

**Schema** (`prisma/schema.prisma` + hand-written migration `prisma/migrations/20260702100000_add_recommendation_outcome/migration.sql`):
- `Recommendation.outcome Json?` — `{ verdict: "improved"|"worsened"|"neutral"|"insufficient_data", metricsBefore: {...}, metricsAfter: {...}, deltas: {...}, windowDays: number, checkedAt: ISO }`
- `Recommendation.outcomeCheckedAt DateTime?`
- Index on `(status, outcomeCheckedAt)`.

**Job** `jobs/check-outcomes.ts` (`checkOutcomesHandler`):
- Select recs with `status: "executed"`, `executedAt <= now - 7 days`, `outcomeCheckedAt: null` (cap 50/run).
- For each: find the latest meta/google_ads `RawSnapshot` for the rec's platform captured BEFORE `executedAt` and the latest captured >= 7 days AFTER. Locate the target entity in each payload by `targetEntityId` (campaigns/adSets/ads/keywords arrays — reuse whatever entity lookup exists or write a tolerant finder over payload keys, missing keys → skip gracefully).
- Metrics compared (whatever exists on the entity): spend, roas, ctr, cpa/costPerConversion, conversions. Verdict rules: primary metric is ROAS if present else CPA else CTR; improved = >5% better, worsened = >5% worse, else neutral; missing either side = `insufficient_data`.
- Write `outcome` + `outcomeCheckedAt`. Never throw per-rec; collect errors, status `partial` on errors.
- Index each decided outcome (not insufficient_data) into the knowledge base: follow `lib/ai/knowledge-sources.ts` patterns; add sourceType `"recommendation_outcome"` with a one-paragraph text summary (skill, action, target, verdict, key deltas). If the KB write fails, log and continue (fail-safe, same as citations).
- Add `"recommendation_outcome"` to the sourceTypes retrieved by `groundSkillContext` in `lib/skills/runner.ts` so future skill runs see what worked.

**Cron route** `app/api/cron/check-outcomes/route.ts`: `requireCronAuth` → `acquireJobLock("check-outcomes")` → handler → release in finally. Document in `docs/CRON.md` (daily, after execute-approved).

**Tests:** verdict computation (improved/worsened/neutral/insufficient) with synthetic before/after payloads; entity finder tolerant of missing arrays; recs younger than 7 days not selected (mocked prisma).

## Task 5: Own-catalog price ingestion + competitor price-gap insights

`ShoppingPriceHistory` only compares competitors to their own past prices; Agriko's own prices aren't ingested at all.

**Spec:**
1. In `jobs/fetch-market-intel.ts`, add a step that fetches Agriko's own products + variants (id, title, handle, price, compareAtPrice, currency) via the existing Shopify admin helper (`lib/shopify-admin.ts` — extend with a products query if none exists; Admin GraphQL `products(first: 100)` with variants). Upsert as `RawSnapshot` source `"shopify_catalog"` with dateRange = capture day. Non-fatal on failure (log, continue with rest of market intel).
2. Price-gap detection, same job, after shopping results are stored: for each active `MarketKeyword`, take that keyword's latest `ShoppingResult` rows and match own products whose title contains the keyword (case-insensitive; conservative — no fuzzy scoring). Where a competitor price < own price by >10%, create a `MarketInsight` `{ type: "price_gap", severity: "warning" (>25% → "critical"), keyword, title: "<store> undercuts <product> by N%", summary with both prices, evidence: JSON with productId/variant price, competitor row }`. Dedup: skip if an open `price_gap` insight exists for the same keyword+store.
3. Surface: no new UI required — `MarketInsight` rows already flow to the market-intelligence dashboard and (via `lib/opportunities/generate.ts`) the Opportunity feed.

**Tests:** matching logic (keyword↔product title), gap threshold/severity, dedup, catalog-fetch failure is non-fatal (mocked prisma + mocked Shopify helper).

## Task 6: Route SkillInsights into the Opportunity feed

`SkillInsight` rows (fatigue-report, search-term-opportunities, competitor-analysis) terminate at a dashboard tile. Route them into `Opportunity` (review-only, non-executable — same pattern as `generateMarketOpportunities` in `lib/opportunities/generate.ts`).

**Spec:**
1. New function `generateSkillInsightOpportunities()` in `lib/opportunities/generate.ts` (or a sibling module if that file is large): read `SkillInsight` rows from the last 2 days, map:
   - `fatigue-report` items → one Opportunity per fatigued ad/creative: `proposedAction.action = "rotate_creative"`, review-only, title "Creative fatigue: <ad name>", evidence = the insight item.
   - `search-term-opportunities` items → `proposedAction.action = "review_search_term"` (potential negative keyword or new keyword; note in description that Google execution is not available).
   - `competitor-analysis` items → `proposedAction.action = "review_competitor_creative"`.
2. Dedup against existing open opportunities by a stable key (insight type + target entity/term). Follow whatever dedup convention `generateMarketOpportunities` uses.
3. Call it wherever `generateMarketOpportunities` is invoked (find the caller; likely opportunity generation in the daily cycle) — same error-isolation semantics.

**Tests:** each insight type maps to the right Opportunity shape; dedup prevents duplicates on second run (mocked prisma).

## Task 7: CompetitorAdCapture reader — ad longevity

`CompetitorAdCapture` (per-capture history of competitor ads) is written every run and read nowhere. Long-running competitor ads are their proven winners — surface that.

**Spec:**
1. `lib/market-intel/ad-longevity.ts`: `computeAdLongevity(competitorId?)` — for ads captured in the last 90 days, compute days-active per adArchiveId (first capture → last capture where activeStatus active), return top N (30) longest-running with competitor, headline, copy excerpt, daysActive, still-active flag.
2. Include a "Long-running competitor ads (proven winners)" section in `lib/market-intel/generate-brief.ts` input context.
3. Expose via the existing market-intelligence API (`app/api/market-intelligence/route.ts`) as an additional response field `adLongevity` so the dashboard can render it later (no UI work in this task).
4. Add longevity lines to the `market_intel` extra-context block from Task 2 (top 10, one line each) — coordinate: Task 2 lands first; extend its `buildExtraContext`.

**Tests:** longevity computation from synthetic capture rows (gaps, still-active, multiple competitors), top-N ordering.

## Task 8: DataForSEO Labs — ranked keywords + competitor keyword gap

GSC is 403/low-density; we already pay for DataForSEO. Use Labs endpoints to get organic visibility independently.

**Spec:**
1. `lib/connectors/dataforseo-labs.ts`, following auth/error patterns of the existing `lib/connectors/dataforseo-shopping.ts` (basic auth `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`):
   - `fetchRankedKeywords(domain, limit)` → POST `/v3/dataforseo_labs/google/ranked_keywords/live` — keyword, position, search volume, cpc, url. DEFAULT limit 20 (metered API — probe small; make limit an env `DATAFORSEO_LABS_LIMIT` default 20, max 100).
   - `fetchDomainIntersection(ourDomain, competitorDomain, limit)` → POST `/v3/dataforseo_labs/google/domain_intersection/live` — keywords competitor ranks for that we don't (filter intersections=false or compute client-side). Same limit discipline.
2. Ingestion: extend `jobs/fetch-market-intel.ts` (guarded by env `DATAFORSEO_LABS_ENABLED=true`, default OFF so nothing spends money until the operator enables it):
   - Ranked keywords for `agrikoph.com` (domain from env `MARKET_INTEL_OWN_DOMAIN`, default `agrikoph.com`) → `RawSnapshot` source `"dataforseo_ranked"`.
   - Intersection vs each active `Competitor` with a website domain (cap 3 competitors/run) → `RawSnapshot` source `"dataforseo_keyword_gap"`.
   - Material gap findings (competitor top-10 rank, volume ≥ 100, we're absent) → `MarketInsight` type `"keyword_gap"`, capped 10/run, deduped by keyword.
3. Add `"dataforseo_ranked"` to the Task 2 `gsc` extra-source fallback chain (gsc → gsc_query_page → dataforseo_ranked) so skills get organic data even while GSC is broken.
4. Document the two env vars in `.env.example` and the job addition in `docs/MARKET_INTELLIGENCE.md`.

**Tests:** connector request shaping + response parsing with mocked fetch; ENABLED=false skips entirely; insight generation thresholds; fallback chain order.

## Final

- Full `npm test`, `npm run lint`, `npm run build`.
- Whole-branch review, fix findings.
- Update `.mex/ROUTER.md` state + `docs/CRON.md`; note deferred-to-human items (apply migration `20260702100000_add_recommendation_outcome`, set `DATAFORSEO_LABS_ENABLED`, add check-outcomes cron to the external scheduler).
- Commit + push to main.
