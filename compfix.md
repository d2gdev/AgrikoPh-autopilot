# Market Intelligence Architecture Review

## Executive Summary

I reviewed the Market Intelligence module end to end. No code changes were made.

Current production data is fresh, but the architecture is still brittle. A read-only production baseline showed `fetch-market-intel` has run `25` successful, `8` partial, and `2` failed times in the last 30 days; latest run succeeded on `2026-06-25T08:24:53Z`. There are currently no duplicate Market Intelligence logical rows in the checked keys, but that is because the happy path is behaving, not because the database enforces correctness.

I would rate the module around **B-/C+ for production reliability**: usable, but not resilient enough for a critical pipeline.

## Findings

### Critical

1. Destructive reset endpoint is protected only by normal app auth plus a static query token.

   `app/api/market-intelligence/reset/route.ts` can delete all Market Intelligence captures, ads, price history, shopping results, and keyword research. `requireAppAuth` also accepts `X-Autopilot-Api-Key`, and the client can send `NEXT_PUBLIC_AUTOPILOT_API_KEY`.

   Root cause: private/admin operations share the same broad auth gate as ordinary UI reads.

   Effect: data-loss blast radius is too large.

   Recommendation: remove this from embedded-app auth, require server-only admin/cron auth, add audit logging, rate limiting, transaction wrapping, and backup confirmation.

### High

2. Capture and keyword research jobs run inline inside HTTP routes.

   Manual and cron routes call handlers directly. The queue currently only supports `dashboard-refresh`. Production has had Market Intel runs lasting `725s`, `711s`, and `1007s`.

   Root cause: long-running ingestion is coupled to request/response lifecycle.

   Effect: upstream latency, provider stalls, deploys, or request timeouts can surface as user-facing failure or stale running jobs.

   Recommendation: enqueue `fetch-market-intel` and `fetch-keyword-research`, return `202`, poll job status, and use heartbeat/retry recovery.

3. Idempotency is implemented in application code, not enforced by database constraints.

   `saveShoppingResult`, `saveShoppingPriceHistory`, and `saveOpenDailyMarketInsight` use `findFirst` then `update/create`. Schema has indexes but no matching unique constraints for these logical keys.

   Root cause: dedupe is advisory.

   Effect: retries or overlapping jobs can create duplicate or inconsistent rows.

   Recommendation: add natural-key unique indexes and real `upsert`s after validating/cleaning existing data.

4. Price history can collapse unrelated records.

   `saveShoppingPriceHistory` dedupes only by `productKey + captured day`, while prior comparison for keyword shopping also only uses `productKey`. `productKey` is a slug of store/brand/title, not a stable market identity.

   Root cause: price identity is under-specified.

   Effect: price deltas can compare the wrong keyword, competitor, product, or source context.

   Recommendation: include source, keyword/competitor, store, currency, provider product URL/id hash, and capture date in the identity.

5. Meta capture silently skips valid-looking configurations.

   The UI lets users save a competitor without a page ID, but the job only sends numeric page IDs to Apify and then skips pages with no Apify result. It also disables Apify globally if any Apify capture exists in the last 6 days.

   Root cause: UI validation and capture requirements are inconsistent.

   Effect: users can configure competitors that never produce ad captures, with no clear feedback.

   Recommendation: require numeric page ID or implement fallback, track per-page last capture, and surface skipped page status in the UI.

### Medium

6. Config writes are under-controlled.

   Competitor pages are `findFirst` then create/update, with no unique DB constraint, no deactivation flow, no audit log, and no rate limit.

   Recommendation: add explicit create/update/deactivate operations, audit actor, and unique constraints for platform/pageId and competitor/platform/pageName.

7. Dashboard API cache and stats can be misleading.

   The route uses process-local cache, returns latest 50/60 rows globally, and computes `openInsights` from the unfiltered first 60 insights.

   Recommendation: compute stats with dedicated counts, return freshness metadata per source, and invalidate cache after mutations.

8. Connector resiliency is inconsistent.

   Serper has timeout but no retry/backoff. DataForSEO posts a task and immediately fetches once, treating empty results as pending but not polling later. Apify can poll up to 10 minutes.

   Recommendation: shared retry policy, source-level circuit breakers, and async continuation for long-running provider tasks.

9. AI translation/classification runs inside the capture job.

   Capture calls translation and angle classification after ingestion, and those call the AI provider in batches.

   Recommendation: split post-processing into its own queued job so capture success is not tied to AI latency.

### Low

10. Translation backfill accounting is incomplete.

    The backfill route totals only shopping/ad headline/ad copy rows and ignores capture headline/copy counts returned by `fillCaptureTranslations`.

    Recommendation: include capture totals and continue while any returned count is nonzero.

## Recommended Order

1. Lock down destructive/admin routes and remove the public API-key fallback from sensitive Market Intelligence mutations.
2. Move Market Intelligence capture and keyword research onto the existing queued job system.
3. Add database-enforced idempotency and fix price-history identity.
4. Fix Meta page capture semantics: page validation, per-page recency, visible skipped/error state.
5. Add connector retry/backoff/circuit-breaker behavior.
6. Improve dashboard payload correctness, source freshness reporting, and cache invalidation.
7. Add integration tests around job retries, duplicate prevention, config updates, and route auth.
