# Market Intelligence Reliability Implementation Plan

This plan is based on the findings in `compfix.md`. The goal is to make Market Intelligence reliable enough for production-critical use without changing the feature's user-facing intent.

## Guiding Principles

- Protect data first: destructive operations must be restricted, audited, and reversible.
- Move ingestion out of request/response paths: UI and cron should enqueue work, not execute long-running jobs inline.
- Make correctness database-enforced: idempotency must not depend only on `findFirst` application logic.
- Prefer visible degradation over silent skipping: skipped connectors, skipped pages, and stale data should be visible in job summaries and UI.
- Ship in small, verifiable phases: each phase should leave production safer than before.

## Phase 0: Preflight And Safety Baseline

**Objective:** Capture current production state and reduce migration risk before changing ingestion behavior.

**Tasks**

1. Run read-only production baseline:
   - `npm run dashboard:baseline:remote -- --days 30 --json`
   - `npm run data:duplicates` on production through SSH if detailed duplicate groups are needed.
2. Validate script availability in the target environment:
   - confirm commands used in this phase exist in the environment before scheduling the window.
   - prefer `npm run` inventory and map to project equivalents.
3. Confirm no active locks or running Market Intelligence jobs before deployment windows.
4. Take a production database backup before schema changes.
4. Document current counts for:
   - `ShoppingResult`
   - `ShoppingPriceHistory`
   - `KeywordResearchResult`
   - `CompetitorAd`
   - `CompetitorAdCapture`
   - `MarketInsight`
   - `CompetitorSocialPage`
5. Add a temporary release checklist entry: do not deploy during active ingestion until queued workers are in place.

**Expected impact:** Low direct user impact, high rollback confidence.

**Complexity:** Low.

**Risk:** Low.

**Dependencies:** SSH access, production DB access through server-local environment, backup storage.

**Acceptance checks**

- Baseline report saved.
- Required scripts validated against target environment.
- Backup completed and restorable.
- Active jobs/locks verified before schema work.

## Phase 1: Lock Down Dangerous Operations

**Objective:** Prevent accidental or unauthorized Market Intelligence data loss.

**Tasks**

1. Restrict `app/api/market-intelligence/reset/route.ts`.
   - Remove ordinary `requireAppAuth` as the only gate.
   - Require a dedicated privileged channel:
     - preferred: explicit server-side admin role in the auth context, or
     - fallback: maintenance service secret + environment allowlist.
   - Do not allow access through `NEXT_PUBLIC_AUTOPILOT_API_KEY`.
   - Keep ordinary embedded/app auth for non-destructive routes.
2. Add audit logging for reset attempts.
   - Record actor, timestamp, confirmation method, deleted row counts, and request metadata.
3. Wrap reset deletes in an explicit transaction.
4. Add a stronger confirmation flow.
   - Require a one-time server-generated nonce or environment-only confirmation secret.
   - Keep the current query string token only as a secondary confirmation, not the primary gate.
5. Add rate limiting and maintenance-mode hard-block:
   - route must fail fast outside maintenance mode.
   - rotate maintenance secret on a short cadence.

**Expected impact:** Eliminates the largest data-loss risk.

**Complexity:** Low to Medium.

**Risk:** Low if tested against non-production data first.

**Dependencies:** Existing `AuditLog` model and auth helpers.

**Recommended order:** First implementation phase.

**Acceptance checks**

- Reset cannot be called from the embedded UI session alone.
- Reset cannot be called with the public client API key alone.
- Reset writes an audit row.
- Reset is transactional.
- Existing authorized maintenance flow still works.

## Phase 2: Move Market Intelligence Jobs Onto The Queue

**Objective:** Decouple ingestion from HTTP request duration and add retry/heartbeat recovery.

**Tasks**

1. Extend `lib/jobs/orchestrator.ts`.
   - Add queued job names:
     - `fetch-market-intel`
     - `fetch-keyword-research`
     - optionally `market-intel-postprocess`
   - Add dispatch branches for each new job.
   - Preserve existing `dashboard-refresh` behavior.
2. Change manual Market Intelligence trigger routes.
   - `app/api/market-intelligence/trigger/route.ts` should enqueue `fetch-market-intel`.
   - `app/api/market-intelligence/keyword-research/route.ts` should enqueue `fetch-keyword-research`.
   - deploy with one-release compatibility path:
     - phase A: queue-first with inline fallback if enqueue fails
     - phase B: remove fallback after stable queue operation is observed.
   - Return `202` with `{ queued: true, runId, status }`.
3. Change cron Market Intelligence routes.
   - Cron can either enqueue or drain directly, but should not run long jobs inline in a short HTTP route.
   - Prefer enqueue + existing `/api/cron/drain-jobs`.
4. Update UI behavior.
   - "Run capture" and "Keyword research" should show queued/running state.
   - Poll job status or reuse existing jobs status snapshot.
   - Do not block the button until full ingestion finishes.
5. Add stale-run recovery checks.
   - Confirm heartbeat updates work for long-running Market Intelligence runs.
   - Confirm stale runs are requeued or failed according to max attempts.

**Expected impact:** Major reliability improvement; fewer request timeouts and stale running jobs.

**Complexity:** Medium.

**Risk:** Medium because queue changes touch job orchestration.

**Dependencies:** Phase 0 baseline, existing `drain-jobs` cron, `JobRun` heartbeat fields.

**Recommended order:** After Phase 1.

**Acceptance checks**

- Trigger endpoints return quickly with HTTP `202`.
- Queued jobs are picked up by `/api/cron/drain-jobs`.
- Long-running Market Intelligence jobs update heartbeat.
- Killing a worker mid-run causes recovery according to queue policy.
- UI shows queued/running/completed/error states accurately.

## Phase 3: Enforce Database Idempotency

**Objective:** Make retries and overlapping runs safe at the database layer.

**Tasks**

1. Define an idempotency contract matrix before schema edits:
   - `ShoppingResult`: provider source + market keyword context + normalized product identity + store + capture date.
   - `ShoppingPriceHistory`: stable product identity + store + currency + capture date, scoped by competitorId or marketKeywordId context.
   - `KeywordResearchResult`: source + keyword + locationName + languageCode + capture date.
   - `MarketInsight`: competitor/context + insight type + stable insight source key + created date window.
   - `CompetitorSocialPage`: `platform + pageId` when pageId exists, else `platform + competitorId + pageName`.
   - `CompetitorAdCapture`: `adArchiveId` as base key; add capture-date bucket only if there is a proven risk of collision.
2. Document normalization and collision policy for each key.
   - define key normalization rules (case, whitespace, URL canonicalization, locale handling).
   - document expected collision behavior and overwrite/merge policy.
3. Add explicit stable key columns where expression indexes are awkward.
   - Example: `captureDate` as UTC date string or date field.
   - Example: `productIdentityHash` from provider URL/id/store/title.
4. Build a per-table duplicate cleanup runbook before enabling hard constraints:
   - select survivors by timestamp + completeness rules.
   - log merged records.
5. Clean duplicates if any exist.
6. Add Prisma schema constraints or raw SQL migrations where Prisma cannot express partial/expression indexes cleanly.
7. Replace `findFirst` then `update/create` with real `upsert` against unique keys.
8. Add retry/idempotency tests for concurrent enqueue attempts.

**Expected impact:** Major correctness improvement; prevents duplicated rows and inconsistent updates.

**Complexity:** High.

**Risk:** Medium to High because schema migrations and data cleanup affect production tables.

**Dependencies:** Phase 0 backup, duplicate report, ingestion identity design.

**Recommended order:** After queue migration, unless duplicate risk becomes urgent.

**Acceptance checks**

- Running the same capture twice on the same day updates existing rows instead of inserting duplicates.
- Concurrent capture attempts cannot create duplicate logical records.
- Keyed fallback/migration policy documented before each unique constraint.
- Duplicate report returns zero duplicate groups after migration.
- Existing dashboard queries still perform acceptably.

## Phase 4: Fix Price History Identity

**Objective:** Prevent incorrect price comparisons and deltas.

**Tasks**

1. Redesign `productKey`.
   - Prefer provider product URL/id when available.
   - Include store and currency.
   - Keep normalized title only as fallback if provider identity is unavailable.
   - explicitly enforce whether same SKU across keyword contexts can share identity or must remain scoped.
2. Add a separate durable identity field.
   - Example: `productIdentityHash`.
   - Keep `productKey` only as display/debug metadata if needed.
3. Change previous-price lookup.
   - For keyword captures, compare within the same `marketKeywordId` or explicit keyword context.
   - For competitor captures, compare within the same `competitorId`.
   - Never compare unrelated keyword and competitor contexts.
4. Adjust price-change insight evidence.
   - Include identity fields used for comparison.
   - Include previous row id and current row id.
5. Backfill identities for existing rows where possible.

**Expected impact:** High data-quality improvement.

**Complexity:** Medium to High.

**Risk:** Medium because historical comparisons may shift.

**Dependencies:** Phase 3 schema work should happen first or in parallel.

**Recommended order:** Immediately after idempotency design, before adding final unique constraints for price history.

**Acceptance checks**

- Same product under different keyword contexts does not overwrite price history.
- Same product under different competitors does not share price deltas.
- Price-change insights include enough evidence to audit the comparison.

## Phase 5: Make Meta Capture Configuration Explicit

**Objective:** Stop silently skipping competitor pages.

**Tasks**

1. Validate page ID requirements in the UI and API.
   - If Apify remains the only capture source, require numeric `pageId`.
   - If page-name fallback is supported, show that fallback has lower confidence.
2. Add per-page capture metadata.
   - Last attempted at.
   - Last success at.
   - Last error.
   - Last skipped reason.
3. Change Apify recency gating.
   - Replace global "any Apify capture in last 6 days" with per-page recency.
4. Update job summary.
   - Count pages attempted, skipped, successful, failed.
   - Include skipped page ids/names in summary.
5. Surface page health in Manage tracking.

**Expected impact:** High observability and configuration reliability improvement.

**Complexity:** Medium.

**Risk:** Low to Medium.

**Dependencies:** Config route cleanup from Phase 6 can share schema/UI changes.

**Recommended order:** After queue migration; before expanding capture volume.

**Acceptance checks**

- Saving a competitor without a usable page ID gives clear feedback.
- A page skipped by capture appears as skipped in job summary or UI.
- A recently captured page does not block unrelated pages from capture.

## Phase 6: Clean Up Config Management

**Objective:** Make tracked competitors, pages, and keywords maintainable and auditable.

**Tasks**

1. Split config actions into explicit operations:
   - Add keyword.
   - Update keyword.
   - Deactivate keyword.
   - Add competitor.
   - Update competitor.
   - Deactivate competitor.
   - Add/update/deactivate social page.
2. Add audit logs for all config changes.
3. Add route-level rate limiting.
4. Add unique constraints for social pages.
5. Avoid reassigning a page to another competitor unless explicitly requested.
6. Update Manage tracking UI to show active/inactive state and page health.

**Expected impact:** Medium reliability and maintainability improvement.

**Complexity:** Medium.

**Risk:** Medium because config routes affect user workflows.

**Dependencies:** Phase 3 constraint decisions.

**Recommended order:** After Phase 5 if page-health UI is being added.

**Acceptance checks**

- Config changes are auditable.
- Removed competitors/pages can be deactivated without deleting history.
- Duplicate pages cannot be created under race conditions.

## Phase 7: Standardize Connector Resiliency

**Objective:** Make provider failures predictable and recoverable.

**Tasks**

1. Add shared connector wrapper.
   - Timeout.
   - Retry with exponential backoff and jitter.
   - Retry only safe status codes/errors.
   - Structured error classification: auth, rate limit, timeout, provider error, malformed response.
2. Add source-level circuit breaker state with half-open recovery.
   - Track repeated failures.
   - Temporarily skip a connector after threshold with cooldown and backoff.
   - run half-open probes before closing the breaker.
   - Surface circuit state in job summary and connector health.
3. Improve DataForSEO task handling.
   - Persist task ids for pending tasks.
   - Poll in later queued job attempts instead of discarding pending work.
4. Improve Apify task handling.
   - Do not run 10-minute polling inside short request paths.
   - Store actor run id and resume/poll through queue.
5. Include provider latency and row counts in `JobRun.summary`.

**Expected impact:** High operational stability improvement.

**Complexity:** Medium to High.

**Risk:** Medium.

**Dependencies:** Queue migration should happen first.

**Recommended order:** After Phase 2 and before increasing capture scope.

**Acceptance checks**

- Provider timeout does not fail the whole job when partial data is available.
- Repeated provider failures are visible as source-level circuit status.
- DataForSEO pending tasks are retried or resumed.
- Apify long polling does not block user-facing routes.

## Phase 8: Split AI Post-Processing From Capture

**Objective:** Keep capture success independent from AI translation/classification latency.

**Tasks**

1. Add queued post-processing job:
   - Translate missing shopping/ad/capture text.
   - Classify missing creative angles.
2. Run post-processing after successful capture or on schedule.
3. Add per-row processing metadata if needed:
   - translationStatus
   - classificationStatus
   - lastProcessingError
4. Fix backfill totals.
   - Include ad capture headline and copy totals.
   - Continue until all returned counts are zero.
5. Add limits to prevent AI cost spikes.

**Expected impact:** Medium reliability improvement; high clarity for capture job status.

**Complexity:** Medium.

**Risk:** Low to Medium.

**Dependencies:** Queue migration.

**Recommended order:** After Phase 2; can happen before Phase 7.

**Acceptance checks**

- Capture can succeed even if AI provider is down.
- Post-processing failures are visible separately.
- Backfill reports all processed categories accurately.

## Phase 9: Improve Dashboard Payload Correctness

**Objective:** Make the Market Intelligence dashboard display accurate, fresh, explainable data.

**Tasks**

1. Replace limited-row-derived stats with dedicated aggregate counts.
2. Add source freshness metadata:
   - Latest shopping result.
   - Latest price history.
   - Latest keyword research.
   - Latest ad capture.
   - Latest insight.
3. Add source status metadata:
   - Last success.
   - Last partial.
   - Last failed error excerpt.
4. Revisit row selection.
   - Avoid showing only global latest rows when per-keyword/per-competitor latest rows are more useful.
   - Consider grouped latest results per keyword/product/competitor.
5. Make cache invalidation explicit after config writes and queued job completion.
6. Replace process-local cache as sole source for prod-grade deployments:
   - enforce shared cache or DB snapshot in multi-process environments;
   - allow process-local cache only for local/single-process development.

**Expected impact:** Medium user trust improvement.

**Complexity:** Medium.

**Risk:** Low.

**Dependencies:** Job summary and source freshness improvements.

**Recommended order:** After core reliability fixes.

**Acceptance checks**

- `openInsights` matches actual open insight count.
- Dashboard shows stale sources clearly.
- Manual config changes and completed jobs are reflected without confusing stale cache behavior.

## Phase 10: Test Coverage And Regression Guardrails

**Objective:** Prevent recurrence of reliability failures.

**Tasks**

1. Add unit tests for natural-key generation.
2. Add tests for idempotent writes.
3. Add concurrency tests for duplicate prevention.
4. Add queue tests:
   - enqueue once
   - duplicate enqueue returns existing run
   - stale heartbeat requeues
   - max attempts fails
5. Add route auth tests for destructive/admin routes.
6. Add connector wrapper tests for retryable and non-retryable failures.
7. Add UI tests for queued/running/completed Market Intelligence states.
8. Add migration verification script to check duplicate groups before applying unique constraints.

**Expected impact:** High regression prevention.

**Complexity:** Medium.

**Risk:** Low.

**Dependencies:** Phases 1-9 as implementation inputs.

**Recommended order:** Add tests incrementally with each phase, then finish with a regression suite.

**Acceptance checks**

- Duplicate prevention tests fail against the old implementation and pass after schema/upsert work.
- Auth tests prove reset cannot be called through ordinary embedded auth.
- Queue tests cover crash/retry behavior.

## Suggested Timeline

These estimates assume one focused engineer with access to production deployment and database backups.

| Phase | Estimate | Risk |
| --- | ---: | --- |
| Phase 0: Preflight | 0.5 day | Low |
| Phase 1: Lock down reset/admin routes | 0.5-1 day | Low |
| Phase 2: Queue Market Intelligence jobs | 1.5-3 days | Medium |
| Phase 3: DB idempotency | 2-4 days | Medium/High |
| Phase 4: Price identity fix | 1-2 days | Medium |
| Phase 5: Meta capture config clarity | 1-2 days | Medium |
| Phase 6: Config management cleanup | 1-2 days | Medium |
| Phase 7: Connector resiliency | 2-3 days | Medium |
| Phase 8: AI post-processing split | 1-2 days | Low/Medium |
| Phase 9: Dashboard payload correctness | 1-2 days | Low |
| Phase 10: Regression guardrails | 1-3 days incremental | Low |

Practical total: **2-3 weeks** for a robust production-grade implementation, or **3-5 days** for the highest-impact safety/reliability subset: Phases 0, 1, 2, and the first part of Phase 3.

## Highest-Impact First Sprint

If the work needs to be staged tightly, implement this first:

1. Lock down reset route.
2. Add `fetch-market-intel` and `fetch-keyword-research` to the queue.
3. Change UI manual triggers to enqueue and poll status.
4. Add duplicate preflight checks and at least one database unique constraint for `KeywordResearchResult`.
5. Fix `ShoppingPriceHistory` identity design before adding its final uniqueness constraint.

This first sprint removes the biggest operational risks while preparing for deeper data correctness work.
