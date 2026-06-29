# Backlog

This is the canonical backlog for production reliability and architecture debt that is important but not part of the current emergency fix.

## Workflow

| Status | Meaning |
| --- | --- |
| Proposed | Captured but not yet sized or accepted |
| Ready | Accepted, scoped, and ready to implement |
| In Progress | Actively being worked |
| Blocked | Cannot proceed without a named dependency |
| Done | Implemented, deployed, and verified |
| Won't Do | Intentionally rejected or superseded |

## Priority

| Priority | Meaning |
| --- | --- |
| P0 | Production outage or active data-loss risk |
| P1 | High reliability/security risk, should be scheduled soon |
| P2 | Material maintainability or resilience improvement |
| P3 | Useful cleanup or polish |

## Backlog Items

### BL-001: Replace browser API-key fallback with proper Shopify session-token auth

- Status: Ready
- Priority: P1
- Area: Shopify embedded auth
- Created: 2026-06-25
- Problem: The embedded app currently relies on `NEXT_PUBLIC_AUTOPILOT_API_KEY` for browser API calls because Shopify App Bridge `idToken()` is timing out in production.
- Why it matters: The public API-key fallback restored production availability, but it is not the right long-term auth boundary for a Shopify embedded app. Proper session-token auth should work reliably so the public fallback can be removed.
- Evidence:
  - Browser console previously showed `idToken unavailable: host did not respond in time`.
  - App Bridge patched same-origin `fetch` and attempted `idToken()` before allowing dashboard API requests.
  - Production was stabilized by bypassing the App Bridge fetch wrapper for same-origin API calls.
- Desired outcome:
  - App Bridge `idToken()` resolves reliably when the app is opened from Shopify Admin.
  - API routes accept verified Shopify session tokens as the primary browser auth mechanism.
  - `NEXT_PUBLIC_AUTOPILOT_API_KEY` is no longer required for embedded browser traffic.
  - Same-origin fetch hardening can be simplified or removed after Shopify token auth is verified.
- Scope:
  - Verify Shopify Partner/Admin app URL, allowed redirection URLs, embedded app settings, app proxy/admin launch URL, and host/shop propagation.
  - Audit OAuth callback flow and session-token verification.
  - Confirm App Bridge initialization order and `shopify-api-key` configuration.
  - Add tests or smoke checks for session-token auth behavior.
  - Remove or restrict browser use of the public API-key fallback after successful rollout.
- Acceptance criteria:
  - Opening Autopilot from Shopify Admin loads without `idToken` timeout errors.
  - Dashboard and embedded app API calls authenticate with Shopify session tokens.
  - API-key fallback is unavailable to normal browser traffic or no longer exposed publicly.
  - Production health remains `ok` after deploy.
  - A rollback path is documented before removing the fallback.
- Estimated effort: 4-8 hours if app settings are correct; 1-2 days if Shopify app configuration or OAuth flow needs correction.
- Dependencies:
  - Access to Shopify Partner/Admin app configuration.
  - Ability to test the embedded app from Shopify Admin.
  - Current production fallback must remain in place until session auth is verified.

### BL-002: Move Market Intelligence jobs onto queue

- Status: Done
- Priority: P2
- Area: Job orchestration, dashboard UX, cron reliability
- Created: 2026-06-25
- Problem: Market Intelligence capture and keyword-research jobs were running inline from API requests and could become stale/unrecovered under timeout and concurrency conditions.
- Why it matters: Inline execution blocked UI flows, increased timeout risk, and created overlapping run risk without queue-level recovery semantics.
- Evidence:
  - `app/api/market-intelligence/trigger/route.ts` now enqueues `fetch-market-intel`.
  - `app/api/market-intelligence/keyword-research/route.ts` now enqueues `fetch-keyword-research`.
  - `app/api/cron/fetch-market-intel/route.ts` and `app/api/cron/fetch-keyword-research/route.ts` now enqueue instead of running inline.
  - `app/api/cron/drain-jobs/route.ts` drains queued runs and reports failed drained runs.
  - `lib/jobs/orchestrator.ts` now dispatches and locks queued `fetch-market-intel` and `fetch-keyword-research` runs with heartbeat/retry-aware lifecycle.
  - Queue route test suite and orchestrator tests verify no inline execution for MI/keyword-research trigger paths.
- Desired outcome:
  - Trigger endpoints return quickly with HTTP `202`.
  - Long-running MI and keyword runs execute only via queue worker cycle.
  - Concurrent MI/keyword run collisions are serialized through job locks.
  - Stale in-progress runs are recovered by queue reclaim logic.
- Scope:
  - Queue dispatch and locking in `lib/jobs/orchestrator.ts`.
  - Trigger path conversion in market-intelligence and cron endpoints.
  - UI status handling via existing polling of `/api/jobs/status`.
  - Test coverage for orchestrator lock, skip/requeue, and queue-route behavior.
- Acceptance criteria:
  - Manual + cron MI routes return queued run payloads, not inline results.
  - Concurrent queue drains serialize the same MI and keyword-research jobs safely.
  - Stuck running jobs are requeued/fail according to `maxAttempts`.
  - UI reflects queued/running/completed states through run status polling.
- Completed: 2026-06-25
- Estimated effort: 1.0 day (partially from prior refactor baseline).
- Dependencies:
  - Baseline job queue model and heartbeat columns already present.
  - `lib/jobs/orchestrator.ts` integration tests available.

### BL-002.1: Queue dispatch for Market Intelligence jobs

- Status: Done
- Priority: P2
- Area: Job orchestration
- Parent: BL-002
- Created: 2026-06-25
- Problem: `fetch-market-intel` and `fetch-keyword-research` were not consistently dispatched through shared queue lifecycle.
- Why it matters: Without queue dispatch coverage, queued MI/keyword jobs cannot be recovered/retried with heartbeat and ownership semantics.
- Evidence:
  - `lib/jobs/orchestrator.ts` dispatch branches for `fetch-market-intel` and `fetch-keyword-research`.
  - Added lock acquisition/release around each dispatch branch.
  - `__tests__/lib/jobs/orchestrator.test.ts` includes lock success and skip/requeue assertions for both jobs.
- Scope:
  - Queue claim/dispatch lifecycle updates.
  - Run lock validation for skipped/double-run behavior.
- Acceptance criteria:
  - MI and keyword jobs are claim-aware on queue drain.
  - Concurrent queue drain attempts do not execute duplicate runs.
  - Lock-held runs are marked skipped and remain recoverable via queue flow.
- Completed: 2026-06-25

### BL-002.2: Convert MI trigger routes to enqueue-only behavior

- Status: Done
- Priority: P2
- Area: API surface
- Parent: BL-002
- Created: 2026-06-25
- Problem: Manual and cron MI entrypoints could execute long-running jobs inline.
- Why it matters: Inline execution increases request timeout risk and bypasses queue recovery.
- Evidence:
  - `app/api/market-intelligence/trigger/route.ts` now enqueues `fetch-market-intel`.
  - `app/api/market-intelligence/keyword-research/route.ts` now enqueues `fetch-keyword-research`.
  - `app/api/cron/fetch-market-intel/route.ts` and `app/api/cron/fetch-keyword-research/route.ts` now enqueue and return quick `202`-style responses.
  - `__tests__/api/market-intelligence-queue-routes.test.ts` asserts inline handlers are not called.
- Scope:
  - Manual MI route conversion.
  - Cron MI route conversion.
  - Queue payload contract retained (`runId`, `status`, `queued`, `jobName`).
- Acceptance criteria:
  - Trigger routes return queued responses in normal operation.
  - Inline handlers are not called from queue request tests.
- Completed: 2026-06-25

### BL-002.3: Queue worker and stale-run visibility

- Status: Done
- Priority: P2
- Area: Queue worker reliability
- Parent: BL-002
- Created: 2026-06-25
- Problem: Long-running MI jobs needed a dedicated worker drain path plus failure surfacing.
- Why it matters: Without worker drain and status alerts, stale or failed runs are harder to recover.
- Evidence:
  - `app/api/cron/drain-jobs/route.ts` drains runs, emits failure alerts for drained failures.
  - `lib/jobs/orchestrator.ts` performs heartbeat updates and `recovered` requeue/fail accounting in drain lifecycle.
- Scope:
  - Drift recovery behavior validated via queue orchestration path.
  - Failure alerting on drained failed runs.
- Acceptance criteria:
  - `drainQueuedJobs` returns recovered + drained summaries.
  - Failures in drained runs trigger alert call path.
- Completed: 2026-06-25

### BL-002.4: Client status and polling behavior alignment

- Status: Done
- Priority: P2
- Area: Dashboard UX
- Parent: BL-002
- Created: 2026-06-25
- Problem: Dashboard actions lacked explicit queue/running state handling.
- Why it matters: Users need visible progress while MI jobs execute asynchronously.
- Acceptance criteria:
  - Polling endpoint for run status remains in use via `/api/jobs/status?runId=...`.
  - UI actions return quickly and transition to queued/running banners/states.
- Scope:
  - Validation against existing MI page flow in `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`.
  - Preserve non-blocking action handling with polling timeout and status refresh.
- Completed: 2026-06-25

## Item Template

```md
### BL-000: Short title

- Status:
- Priority:
- Area:
- Created:
- Problem:
- Why it matters:
- Evidence:
- Desired outcome:
- Scope:
- Acceptance criteria:
- Estimated effort:
- Dependencies:
```
