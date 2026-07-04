# Cron Jobs

Cron scheduling is handled outside the app. The app exposes cron routes that can be called by any trusted scheduler as long as it sends `Authorization: Bearer $CRON_SECRET`.

## Suggested Schedule

| Time (UTC) | Route | What It Does |
|---|---|---|
| 01:00 | `/api/cron/daily` | Daily health pipeline for ads, SEO, blog content, skills, proposals, cleanup, and alerts |
| 03:00 | `/api/cron/fetch-blog-content` | Fetches all Shopify blog articles, runs analyzers, updates `ArticleRecord` rows |
| 04:00 | `/api/cron/fetch-seo-data` | Pulls GSC search queries and GA4 sessions into a `RawSnapshot` |
| 04:15 | `/api/cron/fetch-orders` | Ingests yesterday's Shopify orders into DailySales (+28-day backfill on first run) |
| 04:30 | `/api/cron/snapshot-seo-history` | Stores a durable SEO trend point from the latest GSC snapshot |
| 05:00 | `/api/cron/fetch-ads-data` | Pulls Meta campaigns, ad sets, ads, insights into a `RawSnapshot` |
| 05:30 | `/api/cron/fetch-market-intel` | Captures Google Shopping competitor products/prices and Meta Ad Library creative intel |
| 05:45 | `/api/cron/fetch-keyword-research` | Captures Google Ads keyword planning metrics for tracked market keywords |
| Mon 05:50 | `/api/cron/fetch-gsc-data` | Captures query+page GSC rows into `GscQuery` for historical search analytics |
| 06:00 | `/api/cron/execute-approved` | Dry-runs approved execution queue unless live execution is explicitly enabled |
| 06:30 | `/api/cron/index-knowledge` | Indexes newly available content into the knowledge base for skill grounding |
| 06:45 | `/api/cron/reindex-published` | Scores follow-up SEO performance for content published 14-60 days ago that hasn't been scored yet |
| 07:00 | `/api/cron/check-outcomes` | Measures whether executed recommendations helped by comparing before/after platform metrics |
| 08:00 | `/api/cron/daily-digest` | Posts a one-message operator digest (pending recs, yesterday's executions + outcomes, failed jobs, content published, approvals awaiting review) to ALERT_WEBHOOK_URL |
| Every minute | `/api/cron/drain-jobs?limit=1` | Drains one queued job run and recovers stale claims. This includes `dashboard-refresh`, `fetch-market-intel`, and `fetch-keyword-research` queue entries. |
| Every 5 min | `/api/cron/process-ad-reviews` | Runs queued/retry AI ad-approval review jobs (Pre/Brand/Technical) and advances the approval workflow. |
| Every 5 min | `/api/cron/ad-approval-sla` | Escalates ad approvals that breach reviewer SLAs (Conversion 4h, Penultimate 8h, Final 24h). |
| Every 15 min | `/api/cron/publish-scheduled` | Publishes any `ContentProposal` whose `scheduledPublishAt` has passed |

> **`/api/cron/run-skills` is not scheduled standalone.** It runs inside the 01:00 `/api/cron/daily` pipeline (`daily`'s handler calls `runSkillsHandler()` directly — see its Job Description below). The route still exists for manual/on-demand triggers; do not add a separate cron entry for it, or skills will run twice and double-write recommendations.

## Job Descriptions

### `/api/cron/daily`
Daily health pipeline: refreshes ads, SEO, and blog content, snapshots SEO history when the SEO fetch succeeds, runs skills when at least one fetch succeeds, generates content proposals, prunes old transient rows, and sends stale-data alerts. Raw snapshot pruning skips `seo_history` and snapshots referenced by recommendations so cleanup cannot cascade-delete recommendation history. The executor runs separately at 06:00 so human approval happens between skills and execution.

### `/api/cron/run-skills`
Loads all enabled `.md` files from `skills-source/`, fetches the latest `RawSnapshot` for each platform, and sends each skill's prompt + snapshot data to Claude (via OpenRouter). Parses the structured JSON response, validates with Zod, and writes `Recommendation` rows with `guardStatus` applied. Job duration scales with the number of enabled skills.

### `/api/cron/fetch-blog-content`
Fetches all blog articles from Shopify Admin API (paginated, MAX_PAGES=50). For each article:
- SHA-256 hashes the HTML — skips re-processing if unchanged since last run
- Runs `html-parser` → `blog-seo` → `blog-links` → `blog-topics` analyzers
- Computes inbound link counts across all articles
- Upserts `ArticleRecord` rows

### `/api/cron/fetch-seo-data`
Calls `lib/connectors/gsc.ts` and `lib/connectors/ga4.ts`, merges results into a single `RawSnapshot` of type `seo`.

### `/api/cron/snapshot-seo-history`
Reads the latest GSC raw snapshot and stores a durable `seo_history` point for long-term trend charts.

### `/api/cron/process-ad-reviews`
Drains queued and retry-ready `AdAIJobQueue` rows (Pre/Brand/Technical review stages). For each job: acquires the workflow lock, moves the approval into its `in_*_review` state, runs the matching AI agent under a timeout (90s / 120s Technical), records an `AdAIReport` + `AdReview`, then advances the approval (pass → next stage; needs-revision/reject → terminal-ish). On failure it reverts to the queue state and retries with exponential backoff (1m/5m/15m, 3 retries) before flagging the approval for manual intervention. Runs under a `JobLock`.

### `/api/cron/ad-approval-sla`
Escalates ad approvals stuck with a human reviewer past their SLA: Conversion Reviewer 4h (→ backup, else admin flag), Penultimate Approver 8h (→ backup, else escalate to Final skipping the stage), Final Approver 24h (critical admin flag; no auto-skip). Writes audit + notification rows for each action. Runs under a `JobLock`.

### `/api/cron/fetch-ads-data`
Calls `lib/connectors/meta.ts` (and `google-ads.ts` if credentials present). Writes a `RawSnapshot` of type `ads`.

> **Meta pagination limit:** Single-page fetches only. Accounts with >100 campaigns, >200 ad sets, or >500 insight rows will be silently truncated.

### `/api/cron/fetch-market-intel`
Reads active `MarketKeyword` and `CompetitorSocialPage` records, then:
- Captures Google Shopping results through Serper when `SERPER_API_KEY` is set, with DataForSEO as an optional fallback
- Captures Meta Ad Library creatives through `META_AD_LIBRARY_ACCESS_TOKEN`, falling back to `META_ACCESS_TOKEN`
- Stores shopping result snapshots, price history, competitor ad records, and first-pass `MarketInsight` rows for price changes and new ads

If a provider is not configured, the job records it in the `JobRun.summary.disabledSources` list instead of failing the whole run.

Default spend controls are intentionally conservative: 5 keywords, 20 shopping results per keyword, 10 competitor pages, and 50 ads per page per run. Tune `MARKET_INTEL_KEYWORD_LIMIT`, `MARKET_INTEL_RESULTS_PER_KEYWORD`, `MARKET_INTEL_COMPETITOR_PAGE_LIMIT`, and `MARKET_INTEL_ADS_PER_PAGE_LIMIT` only after confirming provider costs.

### `/api/cron/fetch-keyword-research`
Uses Google Ads API keyword planning to capture historical keyword metrics for active `MarketKeyword` records. It stores average monthly searches, competition, competition index, low/high top-of-page bid micros, and monthly search volume history in `KeywordResearchResult`.

Default geo/language values are Philippines (`GOOGLE_ADS_KEYWORD_GEO_TARGET_ID=2608`) and English (`GOOGLE_ADS_KEYWORD_LANGUAGE_ID=1000`). If Google Ads credentials are missing, the job records `google_ads` in `disabledSources`.

### `/api/cron/fetch-gsc-data`
Stores first-party GSC query+page rows in `GscQuery`. This stream is separate from raw SEO snapshots so the dashboard has durable row-level history for Agriko's own ranking data.

### `/api/cron/fetch-orders`
Calls `lib/connectors/shopify-orders.ts` (paginated Admin API) to pull yesterday's Shopify orders, excluding cancelled orders from revenue. Requires the `read_orders` scope on the client-credentials token — verified once via `scripts/check-order-scopes.ts` before this job was enabled, not re-checked per run. Writes a `shopify_orders` `RawSnapshot` per run and upserts one `DailySales` row per calendar day (`date` is `@unique`, so re-running the same day is idempotent — no duplicate rows). On the very first run (no existing `DailySales` rows), it backfills the trailing 28 days instead of just yesterday.

### `/api/cron/execute-approved`
1. **Stuck-lock recovery** — resets any rec stuck in `"executing"` for >10 minutes to `"failed"` with audit entry
2. **Guardrail re-check** — re-validates approved recs against current guardrail thresholds using `deriveGuardrailInputs()` (re-derives from snapshot, not AI fields). Skipped for `override_approved` recs.
3. **Before-state capture** — records current platform state before making changes
4. **Execution** — calls the appropriate supported mutation. Google Ads mutations are blocked for this release; Google Ads is keyword research only.
5. **Audit trail** — writes `AuditLog` entry with before/after state, intended change, dry-run flag, linked `JobRun`, and outcome

The route is dry-run by default. It captures before-state and writes audit records, but does not call mutation connectors and does not change recommendation status.

Live execution requires both:

- `EXECUTE_APPROVED_LIVE_ENABLED=true`
- `?live=true`

Without both, `/api/cron/execute-approved` remains dry-run even when called by the scheduler.

### `/api/cron/check-outcomes`
Outcome feedback loop: selects up to 50 `Recommendation` rows with `status: "executed"`, `executedAt` at least 7 days ago, and `outcomeCheckedAt: null`. For each, finds the latest `RawSnapshot` for the rec's platform captured before `executedAt` and the earliest captured at least 7 days after, locates the target entity in each payload (campaigns/adSets/ads/keywords, tolerant of missing arrays or an entity that has since been deleted), and compares spend/roas/ctr/cpa/conversions. Primary metric is ROAS if present, else CPA, else CTR; >5% better/worse than baseline is `improved`/`worsened`, otherwise `neutral`; missing data on either side is `insufficient_data`. Writes `outcome` + `outcomeCheckedAt` on the recommendation (never re-selected afterward) and, for decided verdicts, indexes a one-paragraph summary into the knowledge base under `sourceType: "recommendation_outcome"` so future skill runs (`groundSkillContext`) see what worked. Per-recommendation failures are collected rather than thrown; the job reports `partial` if some succeed and some fail. KB indexing failures are logged and swallowed — they never fail the outcome check itself. Runs under a `JobLock`.

**Deploy ordering:** migration `20260702100000_add_recommendation_outcome` MUST be applied (`npm run db:migrate`) BEFORE deploying code that reads it — the regenerated Prisma client selects the new `outcome`/`outcomeCheckedAt` columns on every `Recommendation` read, so deploying first breaks the daily pipeline and the approvals UI with a Prisma `P2022` error.

### `/api/cron/daily-digest`
Assembles a trailing-24h digest — pending recommendations (with >7-day staleness count), executions and their outcome verdicts, failed job runs, content published, and ad-approvals awaiting review — and sends it as a single `daily_digest` webhook message via `lib/alerts.ts`. No-ops the webhook (but still records the JobRun summary) when `ALERT_WEBHOOK_URL` is unset.

### `/api/cron/drain-jobs`
Claims one queued job run at a time from `JobRun`, updates a heartbeat while the job executes, and releases queue ownership when complete. Stale claimed runs are requeued or failed according to `JOB_QUEUE_STALE_MINUTES` and `maxAttempts`.

## Sequence Notes

If you use the suggested schedule above, `run-skills` at 02:00 runs before `fetch-ads-data` at 05:00 on the same night. That means `run-skills` uses the latest available snapshot, typically from the previous fetch. The nightly data flow is:

```
01:00 daily (health pipeline + skills on yesterday's data)
04:30 snapshot-seo-history (durable SEO trend point)
05:00 fetch-ads-data (refreshes snapshot for tomorrow's skills run)
05:30 fetch-market-intel (market and competitor dashboard data)
05:45 fetch-keyword-research (keyword planner dashboard data)
06:00 execute-approved dry-run safety check
07:00 check-outcomes (verdicts on 7+ day old executions)
08:00 daily-digest (operator webhook summary)
```

If you need every dashboard stream refreshed immediately, use the Dashboard's Run Now button. It queues `dashboard-refresh`, which runs the core data jobs under locks and records one trackable parent `JobRun`.

## Manual Triggering

Call any cron route directly with the `CRON_SECRET` header:

```bash
curl -X GET \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/fetch-ads-data
```

Or use the Dashboard's **Run Now** button (calls `POST /api/jobs/trigger` which queues a locked `dashboard-refresh` pipeline).

## Debugging

```bash
# Check overall pipeline status
GET /api/cron/status   (with CRON_SECRET header)

# Check job run history
GET /api/jobs/status   (with App Bridge session token)
```

Both return JSON with recent `JobRun` records including start time, duration, and summary.
