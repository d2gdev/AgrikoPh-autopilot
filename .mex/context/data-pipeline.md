---
name: data-pipeline
description: The data ingestion pipeline — connectors, job handlers, RawSnapshot model, job locking, and health alerts. Load when working on data fetching, connectors, or job infrastructure.
triggers:
  - "connector"
  - "ingestion"
  - "snapshot"
  - "job handler"
  - "fetch-ads"
  - "fetch-seo"
  - "fetch-market"
  - "fetch-gsc"
  - "JobRun"
  - "RawSnapshot"
  - "job lock"
  - "data freshness"
edges:
  - target: context/architecture.md
    condition: when understanding how the pipeline fits the overall system
  - target: context/conventions.md
    condition: when writing a new job handler or cron route
  - target: context/skills-recommendations.md
    condition: when the pipeline output feeds into AI skill runs
  - target: context/decisions.md
    condition: when understanding why the pipeline is structured this way (external cron, single DB)
  - target: patterns/add-cron-job.md
    condition: when adding a new job handler or cron endpoint
  - target: patterns/debug-pipeline.md
    condition: when diagnosing a pipeline failure
  - target: patterns/deploy.md
    condition: when deploying pipeline changes or running migrations in production
last_updated: 2026-06-25
---

# Data Pipeline

## Data Flow

```
External cron → /api/cron/[job] (Bearer CRON_SECRET)
  → requireCronAuth + acquireJobLock("job-name")
  → job handler in jobs/[name].ts
    → connector in lib/connectors/[platform].ts
      → external API (Meta / GSC / GA4 / Google Ads / Shopify)
      → normalised payload
    → prisma.rawSnapshot.upsert({ source, dateRangeStart, dateRangeEnd })
    → write JobRun row (status: success/partial/failed)
  → releaseJobLock("job-name")
  → return JobResult<TSummary>
```

After snapshots are upserted, `run-skills` reads them and feeds them to the AI skill runner.

## Job Handlers (`jobs/`)

| File | Job name | What it fetches |
|------|----------|-----------------|
| `fetch-ads-data.ts` | `fetch-ads-data` | Meta Ads metrics + Google Ads keywords |
| `fetch-seo-data.ts` | `fetch-seo-data` | GSC search queries + GA4 page analytics |
| `fetch-gsc-data.ts` | `fetch-gsc-data` | GSC-only (standalone variant) |
| `fetch-blog-content.ts` | `fetch-blog-content` | Shopify blog articles + internal links |
| `fetch-market-intel.ts` | `fetch-market-intel` | Competitor ads, shopping prices, keyword research |
| `run-skills.ts` | `run-skills` | Reads fresh snapshots → AI skill runs → Recommendation rows |
| `execute-approved.ts` | `execute-approved` | Executes approved recommendations against live APIs |
| `snapshot-seo-history.ts` | `snapshot-seo-history` | Saves a GSC trend point from the latest snapshot |
| `run-dashboard-refresh.ts` | `run-dashboard-refresh` | Refreshes dashboard aggregate cache |

## RawSnapshot Model

- **Unique key:** `(source, dateRangeStart, dateRangeEnd)` — always upsert, never insert blindly
- **`source` values:** `"google_ads"` | `"meta"` | `"ga4"` | `"gsc"` | `"blog"`
- **`payload`:** JSON blob — shape is connector-specific; skills and analyzers must handle missing keys gracefully
- Snapshots linked to `Recommendation` rows are retained even after `RAW_SNAPSHOT_RETENTION_DAYS` TTL — the cascade-delete would destroy recommendation history

## JobRun Model

- Written by every job handler before work starts (status: `running`) and updated on completion
- **Status values:** `queued` | `running` | `success` | `partial` | `failed`
- `partial` is a valid success variant — `isJobSuccessful()` returns true for both `success` and `partial`
- `summary` JSON field shape: `{ recommendationsGenerated, skillsRun, skillsSkipped, skillsTotal, skillHashes, snapshotsFetched }`
- `errorLog` string: concatenated error messages for debugging

## Job Locking (`lib/job-lock.ts`)

- `acquireJobLock(jobName)` — creates a `JobRun` row with status `running`; returns `false` if one already exists
- `releaseJobLock(jobName)` — always called in `finally` block of the cron route
- If a job crashes without releasing the lock, the `jobs:stale` script (`npm run jobs:stale`) reports stuck rows; manual resolution via Prisma Studio

## Connectors (`lib/connectors/`)

- `meta.ts` — Meta Graph API; rate-limited; `META_ACCESS_TOKEN` expires (check `META_TOKEN_EXPIRES_AT`)
- `ga4.ts` — Google Analytics Data API; service account auth via `GA4_SERVICE_ACCOUNT_JSON`
- `gsc.ts` — Google Search Console; service account auth via `GSC_SERVICE_ACCOUNT_JSON`; `GSC_SITE_URL` must match property exactly
- `google-ads.ts` — keyword planning only; OAuth refresh token flow; no writes
- `klaviyo.ts` — dead code; do not use or extend

## Alerts (`lib/alerts.ts`)

- `notifyJobFailure({ jobName, route, error })` — fires a webhook POST to `ALERT_WEBHOOK_URL` with sanitised error info
- `checkAndAlertJobHealth()` — detects stale `running` jobs and repeated `partial` statuses
- `checkAndAlertDataFreshness()` — detects data streams that have silently stopped collecting rows
- Both health checks are called at the end of `/api/cron/daily`
- All alert functions are non-fatal — wrap in try/catch so alert failures never abort the pipeline

## Daily Cron Orchestration (`/api/cron/daily`)

```
parallel: [fetchAdsData, fetchSeoData, fetchBlogContent]
  → if seoResult succeeded: snapshotSeoHistory
  → if any fetch succeeded: runSkills
  → if blog or seo succeeded: generateProposals (Content Pilot)
  → always: cleanupDashboardRetention + checkAndAlertJobHealth + checkAndAlertDataFreshness
```

The daily cron skips skills if ALL data fetches failed — never run AI against stale or absent snapshots.
