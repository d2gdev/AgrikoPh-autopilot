# Dashboard Data Pipeline Architecture and Reliability Plan

Date: 2026-06-25

Scope: source-level audit of the dashboard data pipeline in `autopilot-app`.

Note: this document reflects a code and documentation audit. It does not include live production DB metrics, PM2 logs, or live cron inspection.

## Phase 0: Success Criteria and Operating Targets

This plan is complete only when it can be used to drive implementation, verification, rollout, and incident response. The target state is not merely "fewer errors"; it is a dashboard pipeline with measurable freshness, repeatable ingestion, durable work execution, and observable failure modes.

### Primary reliability goals

- Dashboard data population survives web process restarts, deploys, provider timeouts, and transient DB errors.
- Manual refresh, cron refresh, and publish-triggered refresh use the same durable job system.
- Re-running a job for the same logical data window does not duplicate rows or corrupt dashboard metrics.
- Dashboard APIs return stable read models quickly and do not perform heavy ingestion-time transformations.
- Operators can tell whether the system is healthy, degraded, stale, or failed without reading raw logs.
- Credential state shown in Settings matches the credentials actually used by runtime code.

### Proposed SLOs

These should be confirmed against business expectations, but they are concrete enough to guide implementation:

| Area | Target |
| --- | --- |
| Dashboard API latency | p95 under 1.5s for snapshot-backed dashboards; p99 under 3s |
| Dashboard freshness | Standard daily streams updated within 2 hours of scheduled run |
| Manual refresh visibility | User sees queued/running/completed state within 5 seconds |
| Manual refresh completion | Completes or reports degraded/failure within provider-specific timeout |
| Job durability | 0 jobs lost during deploy/restart |
| Duplicate ingestion | 0 duplicate logical rows after retry or duplicate cron execution |
| Stuck jobs | 0 jobs without heartbeat beyond 2x expected heartbeat interval |
| DB health | p95 DB query latency under 500ms for dashboard read APIs |
| Connector health | Live credential validation available for each configured provider |
| Incident detection | Pipeline stale/degraded alerts within 15 minutes |

### Required evidence before implementation

Before changing production architecture, collect a baseline so improvements can be proven:

- Last 30 days of `JobRun` counts by job, status, duration, and error type.
- Current `JobLock` rows and their ages.
- Duplicate-row counts for `GscQuery`, `KeywordResearchResult`, `ShoppingResult`, `ShoppingPriceHistory`, and `MarketInsight`.
- Dashboard API p50/p95/p99 latency by endpoint.
- Prisma/DB connection usage during cron windows.
- Provider error rate by connector.
- Current cron sources on the server, including `/etc/cron.d`, user crontabs, PM2, and any external scheduler.
- Last successful freshness timestamp per dashboard data stream.

### Production verification queries

Use read-only queries first. Adjust table/column casing to match the generated Prisma/Postgres names if needed.

```sql
-- Active or stale jobs
select "jobName", status, count(*), min("startedAt"), max("startedAt")
from "JobRun"
where "startedAt" > now() - interval '30 days'
group by "jobName", status
order by "jobName", status;

-- Long-running jobs
select id, "jobName", status, "startedAt", "finishedAt",
       extract(epoch from coalesce("finishedAt", now()) - "startedAt") as duration_seconds
from "JobRun"
where "startedAt" > now() - interval '30 days'
order by duration_seconds desc
limit 50;

-- Current locks
select "jobName", "lockedAt", "expiresAt",
       extract(epoch from now() - "lockedAt") as age_seconds
from "JobLock"
order by "lockedAt";

-- Likely duplicate GSC normalized rows
select query, page, "dateRangeStart", "dateRangeEnd", "capturedAt", count(*)
from "GscQuery"
group by query, page, "dateRangeStart", "dateRangeEnd", "capturedAt"
having count(*) > 1
order by count(*) desc
limit 50;
```

## Phase 1: Executive Summary

The dashboard pipeline is brittle because it mixes web requests, cron jobs, long-running ingestion, external API calls, database writes, data transformation, and UI refresh behavior without a durable orchestration layer.

The largest reliability risks are systemic:

- Jobs run inside HTTP/server processes.
- Locks are unsafe and inconsistently applied.
- Database connection limits are documented but not enforced.
- Credentials are split inconsistently between env vars and DB-stored settings.
- Dashboard APIs often recompute from raw or append-only data at request time.
- UI fetch logic can hide backend/auth failures.
- Observability does not prove that dashboard data is fresh or complete.

The remote database is a central single point of failure. Many dashboard endpoints and background jobs fan out into multiple Prisma queries, external calls, and writes without retries, query timeouts, staging, idempotency, or strong transaction boundaries.

When one external provider, credential, cron overlap, DB query, or deploy fails, the system often records partial or stale data, hides the failure, or leaves stuck job state.

The current architecture can work when everything is perfectly timed, but it is not production-grade for a production-critical dashboard.

## Phase 2: Findings

### Critical

#### C1. Non-durable dashboard refresh execution

- Problem: `/api/jobs/trigger` creates a `JobRun`, then uses `setImmediate()` to run the dashboard refresh inside the web process.
- Root cause: background work is started from an HTTP request without a durable queue.
- Why brittle: deploys, process exits, crashes, or PM2 restarts can drop active work after the API already returned `202`.
- Files/functions:
  - `app/api/jobs/trigger/route.ts`
  - `jobs/run-dashboard-refresh.ts`
- Downstream effects:
  - Stuck `running` jobs.
  - Stale dashboards.
  - Lock TTL delays.
  - Partial population.
- Recommended solution: move dashboard refresh into a durable queue/worker with retries, heartbeat, cancellation, resumable state, and job progress.

#### C2. Unsafe job locking model

- Problem: `JobLock` has only `jobName`; no owner token, run id, heartbeat, lease extension, or fencing.
- Root cause: locks are modeled as simple rows rather than owned leases.
- Why brittle: an expired long-running job can overlap with a newer job, then delete the newer lock when it finishes because `releaseJobLock(jobName)` deletes by name only.
- Files/functions:
  - `lib/job-lock.ts`
  - `prisma/schema.prisma`
- Downstream effects:
  - Duplicate ingestion.
  - Racing writes.
  - Corrupted job status.
  - Intermittent "already running" states.
  - False recovery after TTL expiry.
- Recommended solution: use owner-scoped locks with fencing tokens, heartbeat/lease renewal, release-by-owner, and queue-level concurrency limits.

#### C3. Overlapping schedulers and inconsistent locking

- Problem: the daily cron runs ads, SEO, and blog ingestion in parallel without acquiring each job's normal per-job lock. Other entrypoints also bypass locks.
- Root cause: cron routes, manual triggers, publish reindexing, and dashboard refresh paths independently invoke job handlers.
- Why brittle: manual refresh, daily cron, individual cron routes, and publish reindexing can run the same pipelines concurrently.
- Files/functions:
  - `app/api/cron/daily/route.ts`
  - `app/api/cron/publish-scheduled/route.ts`
  - `app/api/content-pilot/index/route.ts`
  - `jobs/run-dashboard-refresh.ts`
- Downstream effects:
  - Duplicate rows.
  - Lock contention.
  - Slow DB.
  - Inconsistent dashboard snapshots.
- Recommended solution: centralize all scheduled/manual work through one job dispatcher with per-stream concurrency rules.

#### C4. Database connection resilience is mostly absent

- Problem: Prisma is global, but remote DB pool behavior is left to `DATABASE_URL`; `connection_limit=10` is only a comment/doc recommendation.
- Root cause: no enforced DB URL validation, no pool timeout policy, no explicit readiness behavior, no query latency instrumentation, and no circuit breaker.
- Why brittle: concurrent dashboard requests, cron fanout, credential lookups, and long ingestion jobs can exhaust or stall remote DB connections.
- Files/functions:
  - `lib/db.ts`
  - `server.js`
  - `docs/OPERATIONS.md`
- Downstream effects:
  - Intermittent Prisma failures.
  - Slow dashboard loads.
  - Cascading job failures.
  - Remote DB connection churn.
- Recommended solution: enforce validated DB URL options, `pool_timeout`, DB `statement_timeout`, PgBouncer or equivalent pooling, connection metrics, and transient retry policy.

#### C5. Credential handling is inconsistent and can report false health

- Problem: some code uses DB-stored encrypted credentials, some uses env vars directly, and some checks env vars before calling the resolver.
- Root cause: there is no single mandatory config/credential abstraction.
- Why brittle: Settings may show a connector as configured while the runtime path still requires an env var.
- Files/functions:
  - `lib/config/resolver.ts`
  - `lib/config/connector-health.ts`
  - `lib/connectors/meta-token.ts`
  - `lib/connectors/shopify-token.ts`
  - `lib/content-pilot/generate-draft.ts`
  - `app/api/images/route.ts`
  - `app/api/social-pilot/route.ts`
- Downstream effects:
  - 401/403 provider failures.
  - Failed token refreshes.
  - Misleading connector-health UI.
  - Manual settings changes not affecting runtime behavior.
- Recommended solution: centralize all secrets through one typed config service, remove direct `process.env` reads from connectors, cache resolved config safely, and add live credential checks.

#### C6. Long-running external work runs inside HTTP routes

- Problem: SEO refresh, market intelligence capture, content indexing, draft generation, and publish reindexing run synchronously or semi-synchronously in route handlers.
- Root cause: route handlers are being used as workers.
- Why brittle: route `maxDuration` limits conflict with slow providers such as Apify, AI, Google, Shopify, and DataForSEO.
- Files/functions:
  - `app/api/seo/refresh/route.ts`
  - `app/api/market-intelligence/trigger/route.ts`
  - `app/api/market-intelligence/keyword-research/route.ts`
  - `app/api/content-pilot/index/route.ts`
  - `app/api/content-pilot/proposals/[id]/generate-draft/route.ts`
  - `app/api/content-pilot/proposals/[id]/publish/route.ts`
- Downstream effects:
  - Request timeouts.
  - Abandoned work.
  - Duplicate retries from users.
  - Stale or partially updated dashboards.
- Recommended solution: routes should enqueue work and return job ids; workers should execute with durable progress.

### High

#### H1. Ingestion is not idempotent

- Problem: many tables are append-only without logical uniqueness; jobs use exact timestamps as date windows.
- Root cause: ingestion does not define stable capture keys or replay-safe writes.
- Why brittle: retries, duplicate cron, or overlapping jobs create duplicate GSC, keyword, shopping, price, and insight rows.
- Files/functions:
  - `prisma/schema.prisma`
  - `jobs/fetch-gsc-data.ts`
  - `jobs/fetch-keyword-research.ts`
  - `jobs/fetch-market-intel.ts`
  - `jobs/fetch-ads-data.ts`
  - `jobs/fetch-seo-data.ts`
- Downstream effects:
  - Inflated trends.
  - Noisy dashboards.
  - Slower queries.
  - Unreliable comparisons.
- Recommended solution: define stable capture windows, unique keys, `upsert`/`createMany skipDuplicates`, and run-level staging.

#### H2. Jobs lack transactional commit boundaries

- Problem: many jobs write partial data across multiple tables and then update `JobRun` separately.
- Root cause: ingestion writes directly into production tables rather than staging and promoting atomically.
- Why brittle: failures can leave half-updated normalized data that dashboards treat as current.
- Files/functions:
  - `jobs/fetch-blog-content.ts`
  - `jobs/fetch-seo-data.ts`
  - `jobs/fetch-market-intel.ts`
  - `app/api/content-pilot/proposals/generate/route.ts`
- Downstream effects:
  - Mismatched article/link metrics.
  - Partial SEO windows.
  - Inconsistent market snapshots.
  - Proposal queue state diverging from opportunity state.
- Recommended solution: write to staging tables keyed by `runId`, validate completeness, then atomically promote.

#### H3. External connector behavior is inconsistent

- Problem: each connector implements its own timeout, retry, auth, JSON parsing, pagination, and error handling.
- Root cause: no shared connector runtime.
- Why brittle: transient provider errors become job failures; some `Promise.race` timeouts do not abort underlying requests.
- Files/functions:
  - `lib/connectors/gsc.ts`
  - `lib/connectors/ga4.ts`
  - `lib/connectors/google-ads.ts`
  - `lib/connectors/dataforseo-shopping.ts`
  - `lib/connectors/apify-meta-ads.ts`
  - `lib/connectors/meta.ts`
  - `lib/connectors/serper-shopping.ts`
- Downstream effects:
  - Hanging work.
  - Provider rate-limit failures.
  - Partial dashboards.
  - Inconsistent error handling.
- Recommended solution: introduce a shared connector client layer with abortable timeouts, retries with jitter, rate limits, circuit breakers, token caching, pagination, and normalized errors.

#### H4. Dashboard APIs recompute heavy summaries live

- Problem: UI endpoints aggregate raw/normalized data at request time instead of reading stable dashboard snapshots.
- Root cause: no materialized read model for dashboard screens.
- Why brittle: dashboard traffic competes with ingestion traffic for the same DB pool.
- Files/functions:
  - `app/api/seo/route.ts`
  - `lib/seo/data.ts`
  - `lib/seo/gsc-normalized.ts`
  - `app/api/market-intelligence/route.ts`
  - `app/api/content-pilot/route.ts`
  - `app/api/campaigns/route.ts`
- Downstream effects:
  - Slow loads.
  - DB pressure.
  - Intermittent API 500s.
  - Stale or inconsistent page-level summaries.
- Recommended solution: jobs should materialize dashboard-ready summary rows; APIs should mostly read one stable snapshot.

#### H5. UI fetch handling masks backend failures

- Problem: `useAuthFetch` falls back to unauthenticated `fetch` on token failure; several pages call `res.json()` without checking `res.ok`.
- Root cause: there is no single strict client API wrapper.
- Why brittle: auth failures and API 500s can look like empty or stale dashboard data.
- Files/functions:
  - `hooks/use-auth-fetch.ts`
  - `app/(embedded)/(ad-pilot)/ad-pilot/page.tsx`
  - `app/(embedded)/(insights)/insights/page.tsx`
  - `app/(embedded)/(seo-pillar)/seo-pillar/page.tsx`
  - `app/(embedded)/(store-pilot)/store-pilot/page.tsx`
- Downstream effects:
  - False "no data" states.
  - Cached error payloads.
  - Hard-to-debug user reports.
- Recommended solution: fail closed on auth token errors; use a shared `fetchJson` client that checks status and validates response shape.

#### H6. Caches and in-flight guards are process-local

- Problem: server caches, rate limits, and in-flight sets live only in memory.
- Root cause: process memory is used for coordination and cache state.
- Why brittle: PM2 restarts, multiple processes, or deploys clear state and allow duplicate work.
- Files/functions:
  - `lib/client-cache.ts`
  - `lib/rate-limit.ts`
  - `app/api/market-intelligence/route.ts`
  - `app/api/content-pilot/proposals/[id]/generate-draft/route.ts`
- Downstream effects:
  - Thundering herd behavior.
  - Stale data.
  - Inconsistent dashboard views.
  - Duplicate AI/provider work.
- Recommended solution: use Redis/Postgres-backed cache, distributed rate limits, and durable in-flight state.

#### H7. Health checks do not reflect pipeline health

- Problem: `/api/health` only runs `SELECT 1`; connector health mostly checks config presence and last job status.
- Root cause: health is checking infrastructure reachability, not dashboard data readiness.
- Why brittle: production can appear healthy while all dashboard data streams are stale or failing.
- Files/functions:
  - `app/api/health/route.ts`
  - `lib/config/connector-health.ts`
  - `lib/alerts.ts`
- Downstream effects:
  - Delayed detection.
  - Poor incident response.
  - False confidence during outages.
- Recommended solution: add readiness checks for DB latency, queue depth, active locks, credential validity, provider reachability, and data freshness per dashboard.

#### H8. Partial status semantics are contradictory

- Problem: `partial` is considered successful by some job logic but maps to HTTP `207` with `ok: false`.
- Root cause: job outcome semantics are not consistently defined.
- Why brittle: dashboards, alerts, and operators cannot consistently distinguish degraded from healthy.
- Files/functions:
  - `lib/jobs/types.ts`
  - `lib/jobs/response.ts`
  - `app/api/jobs/status/route.ts`
- Downstream effects:
  - Silent degradation.
  - Stale "last successful" status.
  - Confusing manual-refresh results.
- Recommended solution: define explicit `success`, `degraded`, `failed`, `skipped`, and `stale` states with per-stream causes.

#### H9. Deployment and cron operations can interrupt or duplicate jobs

- Problem: deployment restarts the app while cron may be active; project notes mention duplicate cron and build-time chunk issues.
- Root cause: deployments are not coordinated with scheduler state.
- Why brittle: work can be interrupted mid-write or scheduled twice.
- Files/functions:
  - `scripts/linode-deploy.mjs`
  - `docs/OPERATIONS.md`
  - `action.md`
- Downstream effects:
  - Duplicate `JobRun`s.
  - Partial snapshots.
  - Failed dashboard refreshes.
  - UI chunk-load errors during deploy.
- Recommended solution: one scheduler source, deploy drain/pause, blue-green release, automatic backups, and post-deploy smoke checks.

### Medium

#### M1. Config resolver has no caching

- Problem: repeated credential lookups hit Prisma during connector-heavy requests.
- Root cause: `getOptionalSecret` and related resolver calls perform DB lookups without a shared cache.
- Files/functions:
  - `lib/config/resolver.ts`
- Downstream effects:
  - Extra DB load.
  - More failure points during provider calls.
- Recommended solution: cache resolved secrets with short TTL and explicit invalidation after settings updates.

#### M2. Provider pagination and truncation are incomplete

- Problem: row limits and page caps can silently omit data.
- Root cause: some providers are queried with fixed limits or limited loops without surfacing truncation.
- Files/functions:
  - `lib/connectors/gsc.ts`
  - `lib/connectors/ga4.ts`
  - `lib/shopify-admin.ts`
- Downstream effects:
  - Missing dashboard data.
  - Misleading SEO/content summaries.
- Recommended solution: implement pagination with truncation flags surfaced in job summaries.

#### M3. DataForSEO task handling is likely incomplete

- Problem: the connector posts a task then fetches once.
- Root cause: async provider task lifecycle is treated like a synchronous API call.
- Files/functions:
  - `lib/connectors/dataforseo-shopping.ts`
- Downstream effects:
  - Pending tasks can return no data and appear as empty results.
- Recommended solution: poll task completion with timeout/backoff or split submit/collect into durable job steps.

#### M4. AI enrichment failures are mixed with ingestion health

- Problem: optional AI post-processing can mark capture jobs partial, while brief generation can store fallback text as if it succeeded.
- Root cause: base ingestion and optional enrichment are not separated in job state.
- Files/functions:
  - `lib/market-intel/translate-captures.ts`
  - `lib/market-intel/classify-angles.ts`
  - `lib/market-intel/generate-brief.ts`
- Downstream effects:
  - Operators cannot tell whether raw data capture failed or optional enrichment failed.
  - Fallback AI output can masquerade as valid generated insight.
- Recommended solution: separate base ingestion status from enrichment status.

#### M5. Read APIs perform writes

- Problem: some GET requests mutate state, such as recovering stale draft statuses.
- Root cause: maintenance/repair behavior is embedded in read endpoints.
- Files/functions:
  - `app/api/content-pilot/proposals/route.ts`
- Downstream effects:
  - Hidden write side effects.
  - Extra DB contention.
  - Surprising behavior during dashboard reads.
- Recommended solution: move recovery to worker maintenance or explicit repair endpoint.

#### M6. Some multi-table updates are non-transactional

- Problem: related records are updated separately.
- Root cause: route handlers perform sequential writes without a transaction.
- Files/functions:
  - `app/api/store-tasks/route.ts`
  - `app/api/market-intelligence/config/route.ts`
- Downstream effects:
  - Partial writes.
  - Store task and opportunity state divergence.
  - Partially saved market-intelligence config.
- Recommended solution: wrap related updates in transactions.

#### M7. Hard-coded local credential path

- Problem: Google Ads config can fall back to a developer-machine path.
- Root cause: local development convenience leaked into production connector logic.
- Files/functions:
  - `lib/connectors/google-ads.ts`
- Downstream effects:
  - Environment-specific failures.
  - Confusing production behavior.
- Recommended solution: remove fallback and require managed credentials.

#### M8. Core pipeline test coverage is thin

- Problem: orchestration, locking, duplicate cron, dashboard API failure modes, and UI `res.ok` handling are not comprehensively tested.
- Root cause: tests focus more on helpers and isolated jobs than production failure modes.
- Downstream effects:
  - Regressions are likely.
  - Concurrency bugs remain hidden.
- Recommended solution: add integration tests with a test DB and mocked providers, plus concurrency/idempotency tests.

### Low

#### L1. Logging is unstructured

- Problem: logs mostly use `console.error` without consistent metadata.
- Root cause: no structured logger or logging contract.
- Downstream effects:
  - Harder incident investigation.
  - Poor correlation between request, job, connector, and DB failure.
- Recommended solution: structured logs with request id, run id, shop, connector, duration, retry count, and provider status.

#### L2. Some API routes lack consistent JSON error handling

- Problem: uncaught DB/provider errors can produce inconsistent responses for clients expecting JSON.
- Root cause: no shared API route error wrapper.
- Downstream effects:
  - UI parsing failures.
  - Poor user-facing error states.
- Recommended solution: standardize API error responses.

#### L3. Operational docs and scripts are inconsistent

- Problem: docs reference commands that do not exactly match package scripts, and stale route/proxy/deploy artifacts increase confusion.
- Root cause: operational documentation has drifted from the current implementation.
- Files/functions:
  - `docs/OPERATIONS.md`
  - `package.json`
  - `proxy.ts`
- Downstream effects:
  - Misoperation during incidents.
  - Increased onboarding/debugging time.
- Recommended solution: reconcile docs with actual commands and remove obsolete entrypoints.

#### L4. Retention may remove forensic data too early

- Problem: cleanup deletes many snapshots after 30 days and job runs after 90 days.
- Root cause: retention policy is not tied to incident/debugging needs.
- Files/functions:
  - `app/api/cron/daily/route.ts`
- Downstream effects:
  - Reduced ability to investigate intermittent historical failures.
- Recommended solution: define retention by operational needs and archive summarized run diagnostics.

## Phase 3: Root Cause Analysis

The failures stem from shared architectural issues rather than a single bad module.

### 1. No durable pipeline boundary

API routes and cron handlers directly execute ingestion. This makes deploys, timeouts, and process crashes part of the data pipeline.

### 2. No consistent concurrency model

Locks are advisory, unsafe, and inconsistently applied. The system assumes jobs will not overlap, but the scheduler and UI allow overlap.

### 3. No idempotent data model

Many ingestion tables accept duplicates, and exact timestamps are used as uniqueness boundaries. Retries and duplicate cron therefore mutate dashboard meaning.

### 4. Split-brain configuration

Env vars, DB credentials, connector health, and actual runtime connector logic disagree. A connector can be configured in the UI but still fail because a specific code path reads only `process.env`.

### 5. Dashboards read operational data directly

Dashboard APIs transform raw and normalized tables while jobs are actively mutating those same tables. This couples user-facing latency to ingestion complexity.

### 6. Observability is incomplete

Health means "DB answered SELECT 1," not "dashboard data is fresh, credentials work, jobs are moving, and queues are healthy."

### 7. Error semantics are inconsistent

Partial results are sometimes success, sometimes failure, sometimes hidden behind fallback content. This makes degraded operation hard to detect.

Together, these issues cause cascading instability. A credential issue, provider timeout, deploy, duplicate cron, or DB pool hiccup does not fail in isolation. It can leave stale snapshots, duplicate rows, stuck locks, misleading health, and UI states that hide the actual failure.

## Phase 4: Remediation Plan

### 1. Stabilize operations immediately

- Expected impact: High
- Implementation complexity: Low
- Risk level: Low
- Dependencies: production access
- Recommended order: first
- Actions:
  - Verify only one cron source exists.
  - Pause cron during deploys.
  - Confirm DB backups.
  - Add deploy smoke checks.
  - Document rollback steps.

### 2. Harden DB connectivity

- Expected impact: Critical
- Implementation complexity: Medium
- Risk level: Medium
- Dependencies: DB provider/pooling support
- Recommended order: second
- Actions:
  - Enforce `connection_limit`.
  - Enforce `pool_timeout`.
  - Add DB `statement_timeout`.
  - Log query latency.
  - Add pool/connection dashboards.
  - Consider PgBouncer or provider-managed pooling.

### 3. Replace ad hoc background execution with a durable worker

- Expected impact: Critical
- Implementation complexity: High
- Risk level: Medium
- Dependencies: queue choice and migration plan
- Recommended order: third
- Actions:
  - Enqueue all manual and cron work.
  - Add worker heartbeat.
  - Add retries and dead-letter handling.
  - Add cancellation and progress.
  - Add queue-depth health checks.

### 4. Redesign locking

- Expected impact: Critical
- Implementation complexity: Medium
- Risk level: Medium
- Dependencies: queue/job ids
- Recommended order: alongside worker work
- Actions:
  - Add owner tokens.
  - Add lease renewal.
  - Release by owner only.
  - Add fencing tokens.
  - Define per-stream concurrency policy.

### 5. Make ingestion idempotent

- Expected impact: High
- Implementation complexity: High
- Risk level: Medium
- Dependencies: schema migrations and data backfill
- Recommended order: after worker/lock foundation
- Actions:
  - Define stable capture windows.
  - Add logical unique constraints.
  - Replace blind inserts with upserts or `createMany skipDuplicates`.
  - Introduce staging tables.
  - Promote completed runs atomically.

### 6. Centralize configuration and credentials

- Expected impact: High
- Implementation complexity: Medium
- Risk level: Medium
- Dependencies: credential migration
- Recommended order: after DB hardening
- Actions:
  - Create one typed config provider.
  - Remove connector-level direct `process.env` reads.
  - Add safe secret caching.
  - Add explicit env fallback rules.
  - Add live connector validation.
  - Add key rotation plan.

### 7. Introduce a shared connector runtime

- Expected impact: High
- Implementation complexity: Medium
- Risk level: Medium
- Dependencies: config provider
- Recommended order: after credentials
- Actions:
  - Standardize retries.
  - Use abortable timeouts.
  - Add provider-specific rate limiting.
  - Add circuit breakers.
  - Cache auth tokens where appropriate.
  - Normalize provider errors.
  - Surface truncation/pagination status.

### 8. Materialize dashboard read models

- Expected impact: High
- Implementation complexity: Medium to High
- Risk level: Medium
- Dependencies: idempotent ingestion
- Recommended order: after ingestion fixes
- Actions:
  - Create dashboard snapshot or summary tables per dashboard.
  - Store freshness metadata.
  - Have APIs read snapshots instead of raw ingestion tables.
  - Keep raw data for audit/debugging only.

### 9. Fix UI/API error contracts

- Expected impact: Medium to High
- Implementation complexity: Low to Medium
- Risk level: Low
- Dependencies: response schemas
- Recommended order: can start early
- Actions:
  - Add shared `fetchJson`.
  - Never fall back to unauthenticated requests after token failure.
  - Check `res.ok` everywhere.
  - Validate response shapes.
  - Never cache failed API payloads as valid data.

### 10. Add observability and tests

- Expected impact: High
- Implementation complexity: Medium
- Risk level: Low
- Dependencies: stable job model
- Recommended order: continuous
- Actions:
  - Add structured logs.
  - Add job metrics.
  - Add freshness alerts.
  - Add integration tests.
  - Add duplicate-run/concurrency tests.
  - Add provider timeout/retry tests.

## Phase 5: Target Architecture

### Database connectivity

- Prisma uses a controlled pool configuration.
- `DATABASE_URL` is validated at boot.
- DB pool timeout and statement timeout are enforced.
- Pool metrics and query latency are observable.
- Readiness checks measure DB latency, not only reachability.

### Job orchestration

- API routes enqueue jobs only.
- Durable workers execute ingestion.
- Workers report heartbeat, progress, retries, and terminal state.
- Failed jobs enter a dead-letter state with enough context to replay.
- Long provider workflows are resumable.

### Locking and concurrency

- Locks include owner/run id, lease expiry, heartbeat extension, and fencing token.
- Locks are released by owner only.
- Per-stream concurrency is explicitly defined.
- Manual refresh and cron share the same queue/concurrency controls.

### Data access layer

- Repositories own DB access.
- Ingestion writes to staging by `runId`.
- Completed runs are atomically promoted.
- Dashboard APIs read materialized summaries.
- Raw provider data remains available for audit/debugging.

### Idempotency

Every external capture has a logical key such as:

- provider
- shop/account
- entity id
- query
- locale
- capture date
- date window

Replays update or skip existing records instead of duplicating them.

### Error handling

- Jobs emit structured states: `success`, `degraded`, `failed`, `skipped`, `stale`.
- Partial/degraded states include per-source cause.
- APIs return consistent JSON errors.
- UI surfaces stale/degraded data explicitly.

### Retry strategy

- Only transient failures retry.
- Retries use jittered backoff.
- Provider-specific rate limits are respected.
- Timeouts are abortable.
- Circuit breakers prevent repeated provider failures from overwhelming the app or DB.

### Credential management

- One config service resolves env and encrypted DB credentials.
- Secrets are cached safely with invalidation.
- Runtime code does not read env vars directly except through the config provider.
- Connector health uses live validation, not only presence checks.
- Credential encryption supports rotation.

### Caching

- Shared cache is Redis or DB-backed.
- Cache entries have TTL and invalidation rules.
- Client cache never treats failed responses as valid data.
- Dashboard snapshots include freshness metadata.

### Logging and monitoring

Logs include:

- request id
- job run id
- job name
- shop/account
- connector
- duration
- retry count
- provider status
- DB query timing where relevant

Monitoring includes:

- DB latency
- queue depth
- active/stuck jobs
- lock age
- connector auth status
- data freshness per dashboard
- recent failure/degraded rate

### Health checks

Health should be split into:

- Liveness: process is running.
- Readiness: app can serve authenticated dashboard traffic.
- Pipeline health: jobs are moving, queues are not backed up, data is fresh.
- Connector health: credentials and provider access are valid.

### Testing strategy

Required coverage:

- Unit tests for pure transforms.
- Integration tests with a real test DB.
- Mock-provider tests for retries, rate limits, and timeouts.
- Concurrency tests for duplicate cron/manual refresh.
- Idempotency tests for repeated runs.
- UI tests for API 401/500/degraded responses.
- Migration/backfill tests for new constraints and summary tables.

## Phase 6: Execution Blueprint

This section turns the audit into implementation-ready work. The sequence is designed to reduce production risk early, then replace the brittle architecture behind feature flags and compatibility layers.

### Workstream 0: Production containment and baseline

- Objective: stop avoidable duplication and capture proof of current failure modes before deeper refactors.
- Dependencies: production shell/DB access.
- Risk: low.
- Target duration: 0.5 to 1 day.

Tasks:

- Verify there is exactly one scheduler source.
- Disable duplicate root/user crons if present.
- Add an operational runbook entry for pausing cron during deploy.
- Confirm DB backup schedule and restore procedure.
- Capture baseline JobRun, lock, duplicate-row, dashboard latency, and freshness metrics.
- Record known provider credential state and live connector failures.

Acceptance criteria:

- One authoritative scheduler source is documented.
- Current active locks and recent job failures are known.
- Duplicate-row baseline exists.
- Dashboard freshness baseline exists.
- A production operator can pause scheduled ingestion before deploy.

Rollback:

- Re-enable previous cron entries only if the new canonical cron is not firing.

### Workstream 1: Database connection and query safety

- Objective: make DB failure modes bounded and observable.
- Dependencies: DB provider limits and production connection string control.
- Risk: medium.
- Target duration: 1 to 2 days.

Tasks:

- Validate `DATABASE_URL` on boot.
- Require explicit connection limit and pool timeout.
- Add DB statement timeout.
- Add query latency instrumentation around dashboard API reads and job writes.
- Add a readiness check that measures DB latency.
- Document the production connection budget: web process, worker process, migrations, shell, and provider pool.

Acceptance criteria:

- App fails fast if required DB pool parameters are missing.
- Dashboard read APIs expose/log query duration.
- Health distinguishes DB reachable from DB slow.
- Connection budget is documented and does not exceed provider limits.

Rollback:

- Restore previous `DATABASE_URL` if pool settings cause immediate production instability.
- Keep query logging disabled by env flag if logs become too noisy.

### Workstream 2: Durable job queue and worker boundary

- Objective: remove long-running ingestion from HTTP request lifecycles.
- Dependencies: queue decision and DB connection budget.
- Risk: high.
- Target duration: 3 to 6 days.

Recommended implementation direction:

- Prefer a Postgres-backed queue first because the app already depends on Postgres and the workload is modest.
- Keep the existing `JobRun` model as the operator-facing run record, but add queue/attempt/heartbeat fields or create a dedicated queue table.
- Add a separate worker process managed by PM2/systemd.
- Routes enqueue jobs and return `jobRunId`.
- Cron routes enqueue jobs; they do not run handlers directly.

Tasks:

- Define job names, payload schemas, dedupe keys, max attempts, and timeout policy.
- Implement worker heartbeat.
- Implement retry with backoff.
- Implement dead-letter state.
- Add job cancellation or superseding behavior for manual refreshes.
- Convert `/api/jobs/trigger` to enqueue dashboard refresh.
- Convert cron routes to enqueue jobs.
- Leave existing handlers callable by the worker during migration.

Acceptance criteria:

- Killing the web process after enqueue does not lose the job.
- Killing the worker while a job is running leaves the job recoverable.
- Deploying during an active job does not produce a false success.
- Dashboard UI can show queued, running, degraded, failed, and completed states.
- No route handler performs long-running provider ingestion directly.

Rollback:

- Keep old direct-run route behavior behind a temporary env flag until worker has passed production soak.
- If the worker fails, disable manual refresh enqueue and keep dashboard read-only until resolved.

### Workstream 3: Owned locks and concurrency policy

- Objective: prevent overlapping runs from corrupting shared data.
- Dependencies: durable job ids.
- Risk: medium.
- Target duration: 2 to 3 days.

Tasks:

- Add lock owner/run id.
- Add fencing token.
- Add heartbeat/lease renewal.
- Release locks by owner only.
- Define concurrency rules for each job stream.
- Ensure daily refresh, individual refresh, manual refresh, publish reindex, and content indexing all use the same concurrency policy.

Recommended concurrency policy:

| Stream | Max concurrent | Dedupe key |
| --- | ---: | --- |
| dashboard-refresh | 1 | shop + dashboard-refresh |
| fetch-ads-data | 1 | shop + date window |
| fetch-seo-data | 1 | shop + date window |
| fetch-gsc-data | 1 | shop + date window |
| fetch-blog-content | 1 | shop |
| fetch-market-intel | 1 | shop + profile + capture date |
| fetch-keyword-research | 1 | shop + capture date |
| run-skills | 1 | shop + source snapshot ids |
| publish-scheduled | 1 | shop |
| generate-draft | 1 per proposal | proposal id |

Acceptance criteria:

- An old job cannot release a newer job's lock.
- A duplicate cron/manual trigger returns the existing queued/running job or a skipped/degraded result.
- Stale locks are visible in health and recoverable by owner/lease rules.

Rollback:

- Keep old `JobLock` table readable while migrating.
- Provide a manual unlock procedure requiring owner/run id confirmation.

### Workstream 4: Idempotent ingestion and staging

- Objective: make retries and duplicate triggers safe.
- Dependencies: duplicate baseline and migration plan.
- Risk: high.
- Target duration: 5 to 10 days.

Tasks:

- Define logical unique keys for every ingestion table.
- Normalize date windows to stable boundaries instead of exact `now` timestamps where appropriate.
- Add unique indexes after deduplicating existing data.
- Use staging records keyed by `runId`.
- Promote complete runs atomically.
- Make failed runs leave staging data isolated from dashboard reads.

Recommended logical keys:

| Data | Logical key |
| --- | --- |
| RawSnapshot | source + shop/account + date range + logical capture key |
| GscQuery | shop + query + page + country/device if present + date range |
| PageAnalytics | shop + path + date range |
| KeywordResearchResult | shop + keyword + location/language + capture date |
| ShoppingResult | shop + keyword + competitor/product url + capture date |
| ShoppingPriceHistory | shop + product url + observed date |
| MarketInsight | shop + source + competitor + external id/url/hash + capture date |
| ArticleRecord | shop + Shopify article id |
| ContentProposal | shop + opportunity/proposal hash + lifecycle status |

Acceptance criteria:

- Running the same job twice for the same logical window does not increase logical row count.
- A failed job does not update dashboard snapshots.
- A retried job can complete without manual cleanup.
- Duplicate cleanup migration has before/after counts.

Rollback:

- Add indexes concurrently where possible.
- Keep raw duplicated records archived until dashboard counts are verified.
- Gate dashboard reads to new summaries behind a feature flag.

### Workstream 5: Unified configuration and credential runtime

- Objective: make connector health match connector behavior.
- Dependencies: credential inventory.
- Risk: medium.
- Target duration: 3 to 5 days.

Tasks:

- Define canonical config keys and provider schemas.
- Route all connector credential reads through one config service.
- Cache resolved credentials with short TTL and explicit invalidation after settings updates.
- Remove direct connector-level `process.env` reads.
- Add live credential validation for each provider.
- Add credential decryption failure handling and rotation plan.

Acceptance criteria:

- Settings health uses the same resolver path as runtime connectors.
- If a credential is configured in the DB, every relevant connector can use it.
- If a credential is missing/invalid, health reports the exact provider and reason.
- No dashboard provider path depends on a developer-machine path.

Rollback:

- Keep env fallback enabled until DB credential paths pass validation.
- Roll back provider by provider, not all at once.

### Workstream 6: Shared connector runtime

- Objective: make provider calls predictable and recoverable.
- Dependencies: config runtime.
- Risk: medium.
- Target duration: 4 to 7 days.

Tasks:

- Create a connector wrapper for fetch/OpenAI/Google clients.
- Standardize abortable timeout handling.
- Standardize transient retry detection.
- Add jittered backoff.
- Add provider-specific rate limits.
- Add circuit breaker state.
- Add normalized connector errors with provider, operation, status, retryability, and duration.
- Implement pagination/polling contracts.

Provider policy matrix:

| Provider | Timeout | Retry | Pagination/polling | Notes |
| --- | --- | --- | --- | --- |
| Shopify | 30s per request | 429/5xx with backoff | cursor pagination | keep token refresh single-flight |
| GSC | 30s per request | 429/5xx/network | page through rows | cache Google auth token |
| GA4 | 30s per request | 429/5xx/network | page through rows | expose truncation |
| Google Ads | 60s operation | 429/5xx/network | API-specific | remove hard-coded local credential fallback |
| DataForSEO | 30s request, bounded task wait | task/status retry | poll until complete | split submit/collect if needed |
| Apify | worker-level max duration | status polling | dataset pagination | never run inside HTTP route |
| Meta APIs | 30s per request | 429/5xx/network | cursor pagination | credential source must be unified |
| AI providers | 60s default, task-specific override | 429/5xx/network | not applicable | separate optional enrichment from core ingestion |

Acceptance criteria:

- A transient provider 500 retries and either succeeds or fails with structured retry metadata.
- A hanging provider request is aborted, not merely raced.
- Provider rate limits do not trigger unbounded concurrent retries.
- Connector errors are visible in job summaries and health.

Rollback:

- Migrate one connector at a time.
- Keep old connector path behind feature flags during migration.

### Workstream 7: Dashboard read models and API simplification

- Objective: make dashboard reads fast, stable, and independent from raw ingestion complexity.
- Dependencies: idempotent ingestion.
- Risk: medium to high.
- Target duration: 5 to 10 days.

Tasks:

- Define a dashboard snapshot schema.
- Materialize one read model per dashboard surface.
- Include freshness, source job ids, degraded sources, and generated-at timestamp.
- Update dashboard APIs to read snapshots.
- Keep fallback-to-live-computation behind a temporary feature flag.
- Add stale/degraded UI states.

Recommended read models:

| Dashboard | Snapshot contents |
| --- | --- |
| Main dashboard | latest jobs, recommendation counts, recent audit log, freshness summary |
| Ad Pilot | campaign summaries, insights, recommendation counts, latest ad snapshot metadata |
| Insights | cross-channel KPI summary, job health, SEO/content/image counts |
| SEO Pillar | GSC/GA4 summary, page health, keyword opportunities, trend history |
| Content Pilot | article inventory, proposal queue summary, link graph summary, traffic attribution |
| Market Intelligence | competitor ads, shopping results, keywords, price history, brief status |
| Store Pilot | store tasks, image/alt state, opportunity summary |

Acceptance criteria:

- Dashboard APIs no longer perform heavy raw-table aggregation under normal operation.
- p95 dashboard API latency meets the target.
- Each API response includes freshness/degraded metadata.
- If ingestion is stale, UI says stale instead of showing silent old data.

Rollback:

- Keep live-computation fallback temporarily.
- Compare old and new API payloads during shadow mode before switching the UI.

### Workstream 8: UI/API contract hardening

- Objective: stop the UI from hiding backend/auth failures.
- Dependencies: stable response schemas.
- Risk: low to medium.
- Target duration: 2 to 4 days.

Tasks:

- Add shared `fetchJson` client.
- Treat auth token failure as a blocking auth failure, not unauthenticated fallback.
- Check `res.ok` everywhere.
- Validate response shape for dashboard APIs.
- Add stale/degraded/error UI states.
- Add cache TTL and invalidation on manual refresh completion.

Acceptance criteria:

- A 401 shows an auth/session error, not an empty dashboard.
- A 500 shows a recoverable error state with retry.
- Failed API responses are not written into client cache as valid data.
- Manual refresh updates status without racing against unfinished background work.

Rollback:

- Release page by page.
- Keep old UI data paths behind local component-level fallback until each page is verified.

### Workstream 9: Observability, alerts, and runbooks

- Objective: make failures visible before users report broken dashboards.
- Dependencies: job/connector metadata.
- Risk: low to medium.
- Target duration: 3 to 5 days.

Tasks:

- Add structured logger.
- Add request id and job run id propagation.
- Add job duration, attempt, retry, connector, and DB timing metrics.
- Add freshness checks per dashboard data stream.
- Add alerts for stale data, stuck jobs, repeated degraded jobs, DB latency, and credential failures.
- Add runbooks for common incidents.

Acceptance criteria:

- An operator can answer: what is stale, why, since when, and which job/provider caused it.
- Alerts fire for stale data without needing a user report.
- Logs for a dashboard refresh can be traced by run id from enqueue to completion.

Rollback:

- Metrics/logging should be additive and can be disabled or sampled if noisy.

### Workstream 10: Test and release hardening

- Objective: prevent regressions in the failure modes that currently break dashboards.
- Dependencies: queue, locks, connectors, and read models.
- Risk: low to medium.
- Target duration: ongoing, with initial 3 to 5 day push.

Tasks:

- Add test DB integration suite.
- Add duplicate-trigger tests.
- Add worker-crash recovery tests.
- Add provider timeout/retry tests.
- Add credential resolver tests for env and DB credentials.
- Add API response contract tests.
- Add UI error-state tests.
- Add migration/backfill verification tests.

Acceptance criteria:

- CI fails if duplicate job execution creates duplicate logical rows.
- CI fails if a dashboard API returns non-JSON errors.
- CI fails if UI pages parse `res.json()` without checking status in new fetch paths.
- Worker recovery from interrupted jobs is tested.

Rollback:

- Keep tests additive; quarantine flaky provider-mock tests until deterministic.

## Phase 7: Implementation Backlog

### Milestone 1: Stop the bleeding

Goal: reduce avoidable production failures before architectural migration.

Tickets:

- Audit and canonicalize production cron.
- Add deploy-time cron pause/drain runbook.
- Validate `DATABASE_URL` pool parameters at startup.
- Add DB latency health check.
- Add basic dashboard freshness query.
- Add duplicate-row baseline report.
- Add structured `runId` to job logs where available.

Done when:

- Duplicate cron is ruled out or removed.
- Production has a known baseline for failures, duplicates, freshness, and job durations.
- DB connection settings are explicit.

### Milestone 2: Queue and lock foundation

Goal: make work durable and concurrency-safe.

Tickets:

- Choose queue backend.
- Add job payload schemas.
- Add worker process.
- Add heartbeat fields.
- Add dead-letter status.
- Add owner-scoped locks.
- Convert `/api/jobs/trigger` to enqueue.
- Convert cron routes to enqueue.

Done when:

- Jobs survive web process restart.
- Duplicate triggers do not overlap.
- Stuck jobs are visible and recoverable.

### Milestone 3: Idempotent core ingestion

Goal: make retries safe for the highest-impact streams.

Tickets:

- Deduplicate and constrain GSC normalized data.
- Deduplicate and constrain keyword research results.
- Deduplicate and constrain market intelligence captures.
- Normalize SEO date windows.
- Add staging/promotion for SEO and market-intel jobs.
- Make raw snapshots replay-safe.

Done when:

- Running the same capture twice does not change logical counts.
- Failed staging runs do not affect dashboard reads.

### Milestone 4: Credentials and connectors

Goal: eliminate false connector health and provider-specific brittle behavior.

Tickets:

- Implement canonical config provider.
- Migrate Meta token usage.
- Migrate Shopify token refresh usage.
- Migrate AI provider usage.
- Remove hard-coded Google Ads path.
- Add live connector validation.
- Add shared connector timeout/retry wrapper.
- Add DataForSEO polling.

Done when:

- Settings health and runtime connector behavior agree.
- Transient provider failures are retried consistently.
- Hanging provider requests are aborted.

### Milestone 5: Snapshot-backed dashboards

Goal: make dashboard APIs stable and fast.

Tickets:

- Define dashboard snapshot schema.
- Materialize main dashboard snapshot.
- Materialize SEO snapshot.
- Materialize market-intel snapshot.
- Materialize content-pilot snapshot.
- Switch APIs to snapshot reads behind feature flags.
- Add stale/degraded response metadata.

Done when:

- Dashboard APIs meet latency SLOs under cron load.
- UI can clearly show fresh, stale, degraded, and failed states.

### Milestone 6: UI and operational hardening

Goal: make failures visible and maintainable.

Tickets:

- Add shared UI `fetchJson`.
- Remove unauthenticated fallback from authenticated fetch path.
- Add dashboard API contract tests.
- Add UI error-state tests.
- Add alert rules.
- Add incident runbooks.
- Add release checklist and rollback checklist.

Done when:

- 401/500/degraded responses produce explicit UI states.
- Operators have alerts and runbooks for stale data, stuck jobs, and credential failures.

## Phase 8: Risk Register

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Queue migration introduces duplicate execution | High | Medium | owner locks, dedupe keys, shadow mode, replay tests |
| Unique indexes fail because existing data has duplicates | High | High | baseline duplicate report, cleanup migration, concurrent indexes |
| DB pool settings too strict | Medium | Medium | staged rollout, observe p95/p99 latency, rollback URL |
| Credential resolver migration breaks provider auth | High | Medium | provider-by-provider flags, live validation before cutover |
| Snapshot read models disagree with old live APIs | Medium | High | shadow comparison before switching UI |
| Added observability creates noisy logs/alerts | Low | Medium | sampling, severity thresholds, alert burn-in period |
| Worker process not supervised correctly | High | Low | PM2/systemd config, liveness check, deploy smoke test |
| Staging tables increase storage | Medium | Medium | retention policy and archive cleanup |
| Optional AI failures still block base dashboards | Medium | Medium | separate enrichment state from base ingestion state |

## Phase 9: Open Architecture Decisions

These decisions should be made before implementation starts. The recommended answer is included, but each one should be confirmed against deployment constraints.

### Queue backend

- Recommendation: start with a Postgres-backed queue to minimize new infrastructure.
- Alternative: Redis/BullMQ if throughput or delayed-job semantics require it.
- Decision criteria: operational simplicity, job durability, retry semantics, visibility, connection budget, and deployment footprint.

### Cache backend

- Recommendation: use Postgres-backed snapshots first; add Redis only if shared low-latency cache/rate limiting becomes necessary.
- Decision criteria: number of app instances, cache invalidation complexity, and operational capacity.

### Connection pooler

- Recommendation: use provider-managed pooling or PgBouncer if the current DB provider supports it cleanly with Prisma.
- Decision criteria: current DB limits, Prisma compatibility, transaction mode constraints, and worker/web concurrency.

### Snapshot schema

- Recommendation: use typed JSON payloads initially for dashboard snapshots, with indexed metadata columns for freshness, dashboard key, shop, status, and source run ids.
- Decision criteria: query needs, migration speed, and how often snapshot fields need relational filtering.

### Retention policy

- Recommendation: keep full job diagnostics for at least 180 days and compact raw provider payloads into archived summaries after operational windows close.
- Decision criteria: storage cost, incident investigation needs, and regulatory requirements.

## Phase 10: Definition of Done

The plan is complete only when these are true:

- No dashboard population job is started with `setImmediate()` or equivalent in-process background execution.
- No cron route performs long-running ingestion directly.
- Every manual/cron/scheduled refresh goes through the same durable job path.
- Locks are owner-scoped and cannot be released by stale workers.
- Re-running a completed job for the same logical window is safe.
- Dashboard APIs read materialized snapshots under normal operation.
- Dashboard responses include freshness and degraded-source metadata.
- UI fetches fail closed on auth errors.
- UI code checks HTTP status before treating JSON as valid dashboard data.
- Connector health uses the same credential path as runtime connectors.
- Provider calls use shared timeout/retry/error handling.
- Health endpoints expose DB, queue, job, lock, connector, and freshness status.
- Alerts exist for stale dashboards, stuck jobs, credential failures, and repeated degraded jobs.
- Tests cover duplicate triggers, worker crash recovery, retries, idempotency, and API error contracts.

## Phase 11: First 10 Implementation Tickets

1. Capture production baseline: job durations/statuses, stale locks, duplicate rows, dashboard freshness, DB latency.
2. Canonicalize production cron and add deploy pause/drain runbook.
3. Enforce and document DB connection pool settings.
4. Add readiness endpoint fields for DB latency, active locks, and stale job count.
5. Design job queue schema and worker process contract.
6. Add owner-scoped lock schema and release-by-owner behavior.
7. Convert `/api/jobs/trigger` to enqueue dashboard refresh behind a feature flag.
8. Add idempotency keys and duplicate cleanup plan for `GscQuery`.
9. Implement canonical credential resolver cache and migrate one provider end to end.
10. Define dashboard snapshot schema and shadow-generate the main dashboard snapshot.

## Phase 12: Validation Matrix

| Scenario | Expected result |
| --- | --- |
| Web process restarts after manual refresh enqueue | Job remains queued/running and completes or fails in worker |
| Worker dies mid-job | Job becomes recoverable/stale after heartbeat timeout |
| Same cron fires twice | Second trigger is deduped, skipped, or attached to existing run |
| Same ingestion window is retried | No duplicate logical records are created |
| DB is slow | Readiness reports degraded and jobs back off instead of cascading |
| Provider returns 429 | Connector retries with backoff and records retry metadata |
| Provider hangs | Request is aborted at timeout and job records structured failure |
| Credential is invalid | Connector health reports invalid credential before scheduled job fails |
| Dashboard snapshot is stale | UI shows stale/degraded state with last successful refresh |
| Dashboard API returns 500 | UI shows error state and does not cache payload as valid data |
| Deploy occurs during active job | Job resumes, retries, or fails explicitly; it is not lost |

## Core Recommendation

Stop treating dashboard population as request-time work.

Move dashboard population into durable, idempotent, observable jobs that produce stable dashboard-ready read models. Dashboard APIs should read those read models quickly and consistently, while background workers handle the complexity of remote providers, retries, credentials, locking, and database writes.
