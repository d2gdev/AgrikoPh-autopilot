---
name: seo-pilot-proposal-actions
description: Diagnose and fix SEO Pilot actions that create Content Pilot proposals which cannot generate or publish the intended draft.
last_updated: 2026-07-11
---

# Pattern: SEO Pilot Proposal Actions

## Use When
- SEO Pilot buttons create proposals, but Content Pilot draft generation/publish does the wrong thing.
- On-page health actions like missing meta, missing H1, or thin content produce confusing or unpublishable proposals.
- SEO Pilot reads stale Search Console data even though normalized GSC tables have newer rows.
- SEO refresh times out or only updates one of raw SEO, normalized GSC, or durable trend data.
- Content Pilot queue shows generic generation failure for SEO-created proposals.
- SEO or Content Pilot brief generation returns a generic failure even though the AI provider works elsewhere.

## Checks
1. Confirm every SEO Pilot proposal type is supported by `lib/content-pilot/generate-draft.ts`.
   - `seo-fix` generates meta title and meta description only.
   - `content-refresh` rewrites body HTML.
   - `new-content` creates a new article draft.
   - `internal-link` creates a link insertion draft.
2. Do not invent proposal types unless `generateDraft`, draft validation, and publish paths all support them.
3. For on-page health:
   - Missing meta => `proposalType: "seo-fix"`.
   - Missing H1 => `proposalType: "content-refresh"` with `proposedState.action: "add_h1"`.
   - Thin content => `proposalType: "content-refresh"` with `proposedState.action: "expand"`.
4. Use canonical article data from `ArticleRecord` server-side. Do not trust client-submitted article titles or word counts as the source of truth.
5. SEO routes that need Search Console or GA4 data should use `lib/seo/data.ts` helpers first:
   - `getLatestGscData()`
   - `getPreviousGscQueries()`
   - `getLatestGa4Data()`
6. When embedded auth falls back to API-key auth and no Shopify shop is available, rate-limit keys must fall back to `getSessionUser(req)` before a shared constant.
7. SEO refresh from the embedded UI must queue durable background work, not run connector fetches inline inside `/api/seo/refresh`.
   - `POST /api/seo/refresh`, `POST /api/seo/keywords`, and `POST /api/seo/brief` require `CONTENT_REVIEW` immediately after embedded auth and before rate limiting, database work, job enqueueing, data reads, or AI work.
   - `/api/seo/refresh` should enqueue `dashboard-refresh` and return `202`.
   - `dashboard-refresh` keeps raw `RawSnapshot` rows, normalized `GscQuery` rows, and durable `seo_history` rows in sync.
   - Raw SEO and normalized GSC windows must use the same `GSC_LAG_DAYS` reporting lag.
   - If `snapshotSeoHistoryHandler()` returns `{ skipped: true }`, report the step as `skipped`, not `success`.
8. SEO opportunity promotion must not treat every opportunity as net-new content.
   - Existing blog-page low-CTR/no-click opportunities => `seo-fix`.
   - Missing-meta article gaps => `seo-fix`.
   - Thin-content article gaps => `content-refresh`.
   - True uncovered query gaps => `new-content`.
   - The analysis endpoint must filter already-covered queries before returning `contentGaps`; do not rely on promotion-time dedup to hide bad suggestions.
   - A GSC query is covered when its query/page pair lands on a known blog article handle or the query has majority meaningful-term overlap with an existing article title.
   - Handle-less `new-content` dedupe must include target keyword/title. Never key all null-handle proposals as one bucket.
   - Proposal-to-opportunity upserts must run after active-proposal filtering, not before it, or skipped duplicates leave stale open opportunities.
   - UI promote handlers must treat any successful `skipped > 0` response as resolved for the current actionable queue, not only duplicate skips; missing-article and non-blog-page skips are also not retryable without changed source data.
9. For H1 fixes, prompt intent is not enough. Draft validation must reject `action: "add_h1"` body drafts that do not contain an `<h1>`.
10. Draft generation failures must preserve operator-actionable details.
   - AI provider auth/config failures should return `503` with a safe message.
   - The queue row should update `draftError` immediately after a failed generate request.
   - Do not expose full secret values; masked provider errors are acceptable.
11. Brief generation routes must follow the same AI provider pattern as Content Pilot draft generation.
   - Use `getAiClient()` defaults unless there is a proven route-specific model requirement.
   - DeepSeek responses can have blank `message.content`; also read `message.reasoning_content` before treating output as empty.
   - Empty brief output should return a retryable `502`; provider auth/config failures should return actionable `503` details.
   - UI error banners should display both `error` and safe `detail` fields. Never return a provider response, raw exception message, secret, or stack trace in `detail`.
12. Persist complete-map attribution for query/page evidence, classify striking-distance opportunities separately, and retain H1-specific findings. Partial analysis must be explicit (never presented as complete); client caches must not retain failed responses and should surface retryable errors.
   - Raw GSC fallback may combine query, page, and query-page evidence only when each snapshot has the selected query snapshot's exact reporting window. Omit mismatched evidence rather than attributing an opportunity to stale pages.
13. GA4 selection must distinguish a missing normalized window from an existing window with zero usable rows. When raw rows are used after an empty normalized window, return `fallbackReason: "normalized_empty"`.
   - A raw snapshot is eligible to replace normalized data only when it contains at least one usable page with traffic. A newer empty raw snapshot must not suppress usable normalized rows.
14. Broad deterministic proposal actions must not silently inherit AI context caps.
   - A bulk meta action that says “all articles” must scan the complete article corpus; the 200-record AI grounding limit applies only to ordinary AI decomposition.
15. On-page health must keep every offender from the route's bounded corpus reachable.
   - Meta title/description length findings use the existing SEO-fix action.
   - Findings without a safe existing proposal type are labelled for manual review instead of rendering a blank action cell.

## Regression Tests
Add or update route tests when changing these paths:
- Missing meta promotion creates `seo-fix`.
- Missing H1 promotion creates `content-refresh` with `action: "add_h1"`.
- Keyword tracking reads normalized GSC data.
- Bad gap-promotion payloads fail before DB writes.
- Existing-page SERP opportunities create `seo-fix`, not `new-content`.
- Already-covered GSC queries do not appear in SEO analysis `contentGaps`.
- Distinct null-handle `new-content` proposals survive active duplicate filtering.
- Proposals blocked as already active do not create/update `Opportunity` rows.
- Skipped SEO promote results are removed from actionable UI queues.
- SEO refresh queues `dashboard-refresh` and does not call fetch handlers inline.
- Dashboard refresh preserves skipped history status.
- Raw SEO fetch uses the configured `GSC_LAG_DAYS` window.
- SEO history snapshot falls back to raw GSC without mutating normalized data.
- Draft generation provider-auth failures return actionable `503` errors and persist a safe `draftError`.
- SEO brief generation accepts `reasoning_content` fallback and returns actionable provider errors.

Current coverage: `__tests__/api/seo-pilot-routes.test.ts`, `__tests__/jobs/seo-refresh-jobs.test.ts`, and `__tests__/api/embedded-fallback-auth-routes.test.ts`.
