# Dashboard Remediation Implementation Plan

## Purpose

This plan turns the dashboard review into an implementation sequence that can be executed safely, with security fixes first, then job execution correctness, data freshness, error handling, responsive/accessibility work, and final hardening.

The dashboard currently works as a high-level operational overview, but it has production risks in these areas:

- Browser-exposed API-key authentication.
- Auth gate that does not block dashboard rendering.
- Manual job actions that can fail silently or claim success before work runs.
- Stale client cache and overlapping fetches.
- Missing per-panel failure states.
- Data correctness gaps in job history, skill insights, and ad spend comparisons.
- Responsive and accessibility issues.

## Scope

### In Scope

- `hooks/use-auth-fetch.ts`
- `lib/auth.ts`
- `components/app-bridge-auth-gate.tsx`
- `app/(embedded)/layout.tsx`
- `app/(embedded)/page.tsx`
- `app/providers.tsx`
- `app/api/jobs/status/route.ts`
- `app/api/jobs/trigger/route.ts`
- `app/api/jobs/trigger-job/route.ts`
- `app/api/dashboard/job-history/route.ts`
- `app/api/dashboard/gsc-movers/route.ts`
- `app/api/dashboard/activity-sparkline/route.ts`
- `app/api/audit-log/route.ts`
- `app/api/ad-pilot/report/route.ts`
- `lib/dashboard/jobs-status.ts`
- `lib/dashboard/job-history.ts`
- `lib/dashboard/gsc-movers.ts`
- `lib/dashboard/activity-sparkline.ts`
- `lib/client-cache.ts`
- Existing recommendation mutation routes used from the dashboard.
- Tests for changed dashboard auth, queue, cache, and API behavior.

### Out of Scope

- Redesigning the whole embedded application.
- Replacing Polaris.
- Changing unrelated pilot pages.
- Rewriting cron handlers unless required to make dashboard job triggering reliable.
- Adding speculative product features not supported by the current dashboard.

## Implementation Principles

- Fix security boundaries before improving UX.
- Prefer one shared source of truth for job metadata and navigation metadata.
- Server-side authorization must not depend on client-side hiding.
- Long-running work should be queued, tracked, and visible.
- Dashboard panels should represent four states explicitly: loading, ready, empty, and error.
- Cached data must carry freshness metadata.
- Data comparisons must include the period being compared.
- UI fixes should preserve existing Polaris patterns.

## Parallel Development Model

This plan can be executed by multiple agents in parallel if shared contracts are created first and high-conflict files are isolated by owner.

### Coordination Rules

- One coordinating agent owns merge order, shared contracts, and final regression.
- Each implementation agent works on one branch or worktree and owns one workstream at a time.
- Before editing, each agent reads the files listed for its assigned phase and checks current git status for those files.
- Agents may add new helper modules freely within their workstream, but shared files require coordination before edits.
- Shared types and route response shapes must be agreed before dependent UI work begins.
- Keep PRs small enough to merge independently, but avoid landing UI that depends on unavailable API fields.
- Every agent records changed files, new response fields, new env vars, and tests run in its handoff.

### Shared Contract Gates

These gates unblock parallel work while keeping integration risk low.

1. Gate A - Auth and permission contract.
   - Define browser auth behavior, private API-key helper boundaries, permission names, and user-facing restricted state.
   - Blocks Phase 1, Phase 4, and dashboard UI mutation states.

2. Gate B - Job registry and run-status contract.
   - Define `lib/dashboard/job-registry.ts`, job names, labels, manual trigger flags, disabled reasons, trigger strategy, and run polling response fields.
   - Blocks Phase 2, Phase 3, Phase 6, Phase 10, and job UI work.

3. Gate C - Dashboard panel state contract.
   - Define client cache entry shape, panel status union, stale metadata, retry conventions, and error shape.
   - Blocks Phase 5 and most panel UI work in Phase 8.

4. Gate D - Navigation contract.
   - Define shared navigation item shape, Shopify context handling, and App Bridge subset rules.
   - Blocks Phase 9 only.

### Recommended Agent Workstreams

#### Agent 1 - Security and Permissions

- Owns Phase 1 and Phase 4.
- Primary files:
  - `hooks/use-auth-fetch.ts`
  - `lib/auth.ts`
  - `components/app-bridge-auth-gate.tsx`
  - `app/(embedded)/layout.tsx`
  - recommendation mutation routes
  - job trigger routes only for auth and permission checks
- Avoids changing job trigger execution semantics beyond permission enforcement.
- Hands off auth helpers, permission helper API, response status conventions, and tests.

#### Agent 2 - Job Registry, Queue, and Observability

- Owns Phase 2, Phase 3, Phase 6, and Phase 10.
- Primary files:
  - `lib/dashboard/job-registry.ts`
  - `lib/dashboard/jobs-status.ts`
  - `lib/jobs/orchestrator.ts`
  - `app/api/jobs/status/route.ts`
  - `app/api/jobs/trigger/route.ts`
  - `app/api/jobs/trigger-job/route.ts`
  - cron wrappers only where required for reliable triggering
- Coordinates with Agent 1 on auth and permission wrappers around trigger routes.
- Hands off registry exports, run polling contract, snapshot metadata, audit log behavior, and tests.

#### Agent 3 - Dashboard Client State and Cache

- Owns Phase 5.
- Primary files:
  - `app/(embedded)/page.tsx`
  - `lib/client-cache.ts`
  - optional `lib/dashboard/client-state.ts`
- Coordinates with Agent 2 for job status/run payloads and with Agent 4 for panel data shapes.
- Hands off panel state helper API, cache metadata behavior, retry behavior, and tests.

#### Agent 4 - Data Correctness

- Owns Phase 7.
- Primary files:
  - `lib/dashboard/job-history.ts`
  - `lib/dashboard/jobs-status.ts`
  - `lib/dashboard/gsc-movers.ts`
  - `lib/dashboard/activity-sparkline.ts`
  - `app/api/ad-pilot/report/route.ts`
  - dashboard display formatting in `app/(embedded)/page.tsx` only when required
- Coordinates with Agent 2 before editing `lib/dashboard/jobs-status.ts`.
- Coordinates with Agent 3 before changing dashboard response shapes consumed by panel state.
- Hands off corrected API payload fields, formatting helpers, and tests.

#### Agent 5 - UX, Accessibility, and Navigation

- Owns Phase 8 and Phase 9.
- Primary files:
  - `app/(embedded)/page.tsx`
  - `components/ui/`
  - `app/(embedded)/navigation.ts` or `lib/navigation.ts`
  - `app/(embedded)/layout.tsx`
  - `app/providers.tsx`
- Waits for Gate B and Gate C before wiring job controls or panel states.
- Coordinates with Agent 1 before editing auth-gated layout behavior.
- Hands off viewport verification, accessibility changes, shared navigation config, and tests.

#### Agent 6 - Test and Regression Integrator

- Owns Phase 11 and final merge validation.
- Starts by scaffolding missing route/component test utilities if needed.
- Pulls in each agent branch in dependency order and runs focused tests after each merge.
- Finishes with the full regression pass, manual verification checklist, and final risk notes.

### File Collision Map

- `app/(embedded)/page.tsx` is high conflict. Agents 3, 4, and 5 must sequence edits or split work into helpers first.
- `lib/dashboard/jobs-status.ts` is high conflict. Agent 2 owns snapshot/run metadata; Agent 4 owns correctness fixes.
- `app/api/jobs/trigger/route.ts` and `app/api/jobs/trigger-job/route.ts` are high conflict. Agent 1 owns auth/permissions; Agent 2 owns execution behavior.
- `app/(embedded)/layout.tsx` is high conflict. Agent 1 owns auth gate placement; Agent 5 owns navigation rendering.
- `app/providers.tsx` should wait for the navigation contract before any App Bridge nav changes.

### Merge Strategy

1. Merge contract-only changes first:
   - auth/permission helper signatures.
   - job registry shell and exported types.
   - dashboard panel state types.
   - navigation config types.

2. Merge server foundations next:
   - auth gate and protected route behavior.
   - job registry, trigger routes, queue/run tracking, snapshot metadata.
   - data correctness route and library fixes.

3. Merge client behavior next:
   - cache and panel state.
   - run polling.
   - disabled permission states.
   - responsive and accessibility updates.

4. Merge navigation and observability after core dashboard behavior is stable.

5. Run final regression and manual verification only after all workstreams are merged.

## Phase 1 - Security Boundary and Auth Gate

### Goal

Remove browser-exposed API-key auth from dashboard requests and prevent dashboard data requests from firing before App Bridge auth is ready.

### Files

- `hooks/use-auth-fetch.ts`
- `lib/auth.ts`
- `components/app-bridge-auth-gate.tsx`
- `app/(embedded)/layout.tsx`
- `.env.example`
- Tests for auth behavior.

### Tasks

1. Remove `NEXT_PUBLIC_AUTOPILOT_API_KEY` support from `useAuthFetch`.
   - Delete the code path that reads `process.env.NEXT_PUBLIC_AUTOPILOT_API_KEY`.
   - Delete the branch that attaches `x-autopilot-api-key` from browser code.
   - Keep App Bridge bearer token behavior as the browser path.

2. Split browser auth from server-to-server auth.
   - Keep `requireAppAuth()` accepting App Bridge session tokens.
   - Introduce or preserve a separate helper for private scripted access, for example `requirePrivateApiKeyAuth()`, if direct scripted access is still required.
   - Do not let browser dashboard API routes accept the public env var path.

3. Update environment documentation.
   - Remove `NEXT_PUBLIC_AUTOPILOT_API_KEY` from examples or clearly mark it as forbidden/deprecated if present.
   - Keep private `AUTOPILOT_API_KEY` server-only.

4. Make `AppBridgeAuthGate` enforce state.
   - Use `useAppBridgeAuth()` snapshot.
   - Render a Polaris loading state while status is `idle` or `loading`.
   - Render a critical banner with retry/reload when status is `error`.
   - Render children only when status is `ready` and initialized.

5. Prevent dashboard API calls before auth readiness.
   - Either gate at layout level only or expose auth state to dashboard page.
   - Ensure `DashboardPage` does not mount and run `load()` before the gate allows children.

### Acceptance Criteria

- Browser bundle does not reference `NEXT_PUBLIC_AUTOPILOT_API_KEY`.
- Dashboard protected APIs cannot be called from the browser using an exposed API key.
- Dashboard does not render widgets or start data fetches until App Bridge auth is ready.
- Auth failure shows an actionable user-facing state.
- Existing server-to-server automation still has an explicit, server-only auth path if needed.

### Tests

- Unit test `useAuthFetch` does not attach `x-autopilot-api-key`.
- Unit test auth gate renders loading, error, and children states correctly.
- Route tests prove protected dashboard APIs reject unauthenticated browser requests.
- Route tests prove private API-key auth only works through intended server-only helper, where still supported.

## Phase 2 - Unified Job Registry

### Goal

Make displayed job health rows and executable job actions use the same metadata.

### Files

- New file: `lib/dashboard/job-registry.ts`
- `lib/dashboard/jobs-status.ts`
- `app/api/jobs/trigger-job/route.ts`
- `app/(embedded)/page.tsx`
- Existing cron route references.
- Tests for job registry behavior.

### Tasks

1. Create a shared job registry.
   - Define job `name`.
   - Define user-facing `label`.
   - Define whether the job is manually triggerable.
   - Define trigger strategy: queued job, direct cron route, or disabled.
   - Define cron path where still required.
   - Define expected cadence or staleness thresholds if available.

2. Replace `JOB_NAMES` with registry-derived names.
   - Export `DASHBOARD_JOB_NAMES`.
   - Export `TRIGGERABLE_DASHBOARD_JOBS`.

3. Update job status payload.
   - Include `label`.
   - Include `manualTriggerEnabled`.
   - Include optional `manualTriggerDisabledReason`.
   - Include queued/running/stale-running fields already computed server-side.

4. Update dashboard UI.
   - Display `label` instead of raw slug.
   - Hide or disable `Run now` for non-triggerable jobs.
   - Show a tooltip or subdued reason when manual trigger is unavailable.

5. Update `/api/jobs/trigger-job`.
   - Validate against registry.
   - Return structured errors:
     - unknown job.
     - job is visible but not manually triggerable.
     - job is triggerable but currently already queued/running.

### Acceptance Criteria

- Every job row either triggers successfully or clearly states why it cannot be manually triggered.
- No job names are duplicated across files.
- Raw job slugs are not shown as primary user-facing labels.
- Adding a future job requires one registry entry, not edits in multiple unrelated files.

### Tests

- Registry tests for all current jobs.
- Route tests for supported job, unsupported visible job, and unknown job.
- UI tests or component tests for trigger button enabled/disabled states.

## Phase 3 - Durable Job Triggering and Run Tracking

### Goal

Replace fire-and-forget manual job behavior with reliable queued or awaited execution, and show real run state in the dashboard.

### Files

- `lib/jobs/orchestrator.ts`
- `app/api/jobs/trigger/route.ts`
- `app/api/jobs/trigger-job/route.ts`
- `app/api/jobs/status/route.ts`
- `app/(embedded)/page.tsx`
- Cron route handlers if they must be wrapped.
- Tests for queue and dashboard polling.

### Tasks

1. Extend queue support where appropriate.
   - Add queue names for manually triggered dashboard jobs that should be durable.
   - Implement dispatchers for those jobs in `dispatchQueuedRun()`.
   - Prefer queued execution over direct cron fetch for long-running jobs.

2. Fix primary `Run Now`.
   - Keep returning `runId`.
   - Trigger or document the mechanism that drains queued jobs.
   - If this app owns draining, call the drain endpoint or orchestrator after enqueue.
   - If an external scheduler owns draining, show `queued` explicitly and poll until claimed.

3. Add run polling to dashboard.
   - Store active run state:
     - `runId`
     - `jobName`
     - `status`
     - `startedAt`
     - `completedAt`
     - `errorLog`
   - Poll `/api/jobs/status?runId=...` while status is `queued` or `running`.
   - Stop polling on terminal states.
   - Refresh dashboard data after terminal success or partial success.

4. Replace success toast timing.
   - Initial action: show queued or started.
   - Completion: show success, partial, failed, or skipped based on run status.
   - Failure: show actual server error where available.

5. Remove fire-and-forget cron fetch.
   - If any direct cron call remains, await it and propagate status, body, and errors.
   - Do not return `202` unless the work is truly queued and trackable.

### Acceptance Criteria

- Manual job trigger gives a reliable run state.
- The dashboard does not claim a job was triggered if the backend failed to start it.
- Primary `Run Now` shows queued/running/completed/failed.
- Job health and recent activity update after job completion.

### Tests

- Route tests for enqueue created and already queued.
- Route tests for direct trigger failures if any direct trigger remains.
- Orchestrator tests for newly supported queue jobs.
- UI tests for polling transitions and terminal failure display.

## Phase 4 - Authorization for High-Impact Actions

### Goal

Add explicit permission checks for expensive or state-changing dashboard actions.

### Files

- `lib/auth.ts`
- New file if useful: `lib/permissions.ts`
- `app/api/jobs/trigger/route.ts`
- `app/api/jobs/trigger-job/route.ts`
- `app/api/recommendations/[id]/approve/route.ts`
- `app/api/recommendations/[id]/reject/route.ts`
- `app/api/recommendations/[id]/request-override/route.ts`
- UI routes that expose these actions.

### Tasks

1. Define permission model.
   - Minimum permissions:
     - `dashboard:view`
     - `jobs:run`
     - `recommendations:review`
     - `recommendations:override`
   - Map current private app user/session data to permissions.
   - If there is no user role source, use a server-side allowlist env var as a first implementation.

2. Add server-side enforcement.
   - Jobs trigger routes require `jobs:run`.
   - Approve/reject require `recommendations:review`.
   - Override routes require `recommendations:override`.

3. Add UI permission states.
   - Hide or disable actions when permission is absent.
   - Show a clear restricted message where the user can see the dashboard but cannot mutate.

4. Add audit logging.
   - Log denied mutation attempts where useful.
   - Include actor, action, route, entity ID, and reason.

### Acceptance Criteria

- A user without mutation permission cannot trigger jobs or approve/reject recommendations server-side.
- UI state matches server permissions.
- Denied attempts return `403`, not ambiguous `401` or `500`.

### Tests

- Route tests for allowed and denied actors.
- UI tests for hidden/disabled action controls.

## Phase 5 - Dashboard Data State Model

### Goal

Replace ad hoc dashboard state with explicit panel states, request ordering, abort handling, stale-data metadata, and per-panel retry.

### Files

- `app/(embedded)/page.tsx`
- `lib/client-cache.ts`
- Optional new file: `lib/dashboard/client-state.ts`
- Tests for cache and data loading behavior.

### Tasks

1. Replace bare cache values with cache entries.
   - Shape:
     - `value`
     - `storedAt`
     - `expiresAt`
   - Add `getFreshCache()`.
   - Add `getStaleCache()` when stale display is acceptable.

2. Add per-panel state.
   - Recommended shape:
     - `status: "idle" | "loading" | "ready" | "empty" | "error" | "stale"`
     - `data`
     - `error`
     - `loadedAt`
   - Use this for:
     - job status.
     - audit log.
     - job history.
     - GSC movers.
     - activity sparkline.
     - ad trend.

3. Add request ordering guard.
   - Use a request sequence ref.
   - Ignore responses from older request sequences.
   - Use `AbortController` on unmount and before starting a replacing request.

4. Add panel retry functions.
   - Each secondary request should have its own retry.
   - Keep a global refresh action for all panels.

5. Add freshness display.
   - Show `Last updated ...` for dashboard status.
   - Show stale warning when rendering stale cached data after a failed refresh.

### Acceptance Criteria

- Old responses cannot overwrite newer dashboard data.
- Failed secondary panels show error states, not false empty states.
- Stale cached data is labeled as stale.
- Users can retry failed panels.

### Tests

- Cache TTL unit tests.
- Loader tests for stale response ignored.
- Component tests for loading/error/empty/stale states.

## Phase 6 - Performance and Snapshot Strategy

### Goal

Reduce expensive dashboard status queries and make status materialization intentional.

### Files

- `lib/dashboard/jobs-status.ts`
- `app/api/jobs/status/route.ts`
- `app/api/jobs/trigger/route.ts`
- Job completion code paths.
- Retention cleanup if snapshot volume changes.

### Tasks

1. Turn snapshot reads on by default for dashboard status.
   - Avoid relying on `JOBS_STATUS_READ_SNAPSHOT === "true"` as an optional production toggle.
   - Use fresh snapshot when within TTL.
   - Rebuild only when missing or expired.

2. Materialize status after job completion.
   - Update status snapshot when queued jobs finish.
   - Materialize after recommendation approve/reject if counts changed.

3. Add timing metadata.
   - Add `computedAt`.
   - Add `fromSnapshot`.
   - Add `snapshotAgeMs`.

4. Add query observability.
   - Log slow dashboard status builds.
   - Keep DB latency in payload but do not make it the only performance signal.

### Acceptance Criteria

- Repeated dashboard loads within TTL avoid rebuilding the full aggregation.
- Dashboard can show whether status is fresh or snapshot-backed.
- Slow builds are observable.

### Tests

- Unit tests for snapshot hit, miss, expired, and invalid payload.
- Route tests for `fromSnapshot` metadata.

## Phase 7 - Data Correctness Fixes

### Goal

Fix known incorrect or ambiguous dashboard metrics.

### Files

- `lib/dashboard/job-history.ts`
- `lib/dashboard/jobs-status.ts`
- `lib/dashboard/gsc-movers.ts`
- `lib/dashboard/activity-sparkline.ts`
- `app/api/ad-pilot/report/route.ts`
- `app/(embedded)/page.tsx`

### Tasks

1. Fix job history starvation.
   - Preferred: use SQL row number partitioned by `jobName`.
   - Alternative: query each job independently with `take: 7`.
   - Preserve return shape.

2. Fix latest skill insight selection.
   - Query latest insight per `insightType` explicitly.
   - Avoid relying on `distinct` with global ordering.

3. Fix ad spend comparison.
   - Include `dateRangeStart` and `dateRangeEnd` in selected snapshots.
   - Compare only equivalent windows.
   - If no equivalent prior window exists, show current spend without delta.
   - Include period labels in API response.

4. Fix job health severity.
   - Treat stale running jobs as critical.
   - Treat actively running or queued jobs as info unless stale.
   - Treat never-run jobs separately from failed/stale jobs.
   - Add job cadence override if not every job runs daily.

5. Fix activity sparkline buckets.
   - Capture `now` once.
   - Decide timezone:
     - shop timezone if available.
     - configured dashboard timezone.
     - UTC with explicit label.
   - Return bucket timezone in payload.

6. Fix content lift sign.
   - Add sign formatting helper.
   - Use positive, negative, and zero display states.

7. Harden `timeAgo()`.
   - Return fallback for invalid dates.
   - Return future labels for future dates.

### Acceptance Criteria

- Job history consistently shows up to 7 runs per job.
- Skill cards use the latest insight per type.
- Ad spend delta is hidden or labeled when periods are not comparable.
- Job health state is accurate for queued, running, stale, never-run, failed, and successful jobs.
- Time labels do not render `NaN`.

### Tests

- Unit tests for job history with noisy and quiet jobs.
- Unit tests for latest skill insight selection.
- Unit tests for ad spend equivalent-period matching.
- Unit tests for `timeAgo()` and content lift formatting.
- Unit tests for activity bucket generation.

## Phase 8 - Dashboard UX and Accessibility

### Goal

Make the dashboard usable in embedded/mobile widths and accessible to assistive technology.

### Files

- `app/(embedded)/page.tsx`
- Optional shared UI components under `components/ui/`.

### Tasks

1. Replace non-wrapping rows.
   - Replace major `InlineStack wrap={false}` card rows with responsive grid components.
   - Use existing `components/ui/stat-grid.tsx` and `components/ui/stat-card.tsx` if they fit local patterns.
   - Ensure Operations, Performance, Intel, Skill Insights, and Trends wrap cleanly.

2. Improve sparkline accessibility.
   - Add `role="img"` and `aria-label` summaries.
   - Provide visible textual summary already present where possible.
   - Avoid relying only on `title` attributes.

3. Improve trend dots accessibility.
   - Add an accessible text summary like `Last 7 runs: success, failed, success`.
   - Avoid color-only status communication.

4. Improve job disclosure controls.
   - Add `aria-label`.
   - Add `aria-controls` matching `Collapsible` ID.
   - Ensure keyboard focus style remains visible.

5. Improve pending recommendation controls.
   - Disable both approve and reject while one action is pending.
   - Show specific conflict messages from server `409`.
   - Add retry after failed mutation.

6. Improve clipboard copy behavior.
   - Catch clipboard errors.
   - Show success and failure toasts.

7. Improve panel empty states.
   - Empty state text should identify missing data source:
     - no GSC snapshots.
     - no audit events.
     - no ad snapshots.
     - no skill insights.

### Acceptance Criteria

- Dashboard does not horizontally overflow at common embedded widths.
- Keyboard users can operate job row disclosure and actions.
- Screen readers get useful summaries for sparklines and job trend dots.
- Pending recommendation actions cannot conflict from one row.
- Empty states distinguish no data from failed loading.

### Tests

- Component tests for accessible labels.
- Playwright viewport checks for desktop and narrow embedded widths.
- Optional axe accessibility smoke test for dashboard page.

## Phase 9 - Navigation Consistency

### Goal

Generate Polaris side navigation and App Bridge `NavMenu` from one shared configuration.

### Files

- New file: `lib/navigation.ts` or `app/(embedded)/navigation.ts`
- `app/(embedded)/layout.tsx`
- `app/providers.tsx`

### Tasks

1. Create shared navigation config.
   - Include labels, hrefs, section groups, and match rules.

2. Update `EmbeddedLayout`.
   - Build Polaris `Navigation.Section` items from shared config.

3. Update `Providers`.
   - Build `NavMenu` links from shared config or a deliberate subset marked in config.

4. Preserve Shopify context URLs.
   - Keep `withShopifyContextUrl()` for generated links.

### Acceptance Criteria

- No duplicated hardcoded navigation lists.
- App Bridge navigation is intentionally complete or intentionally subsetted by config.
- Active matching behavior remains correct.

### Tests

- Unit test config-to-link generation where practical.
- Manual navigation smoke test in embedded context.

## Phase 10 - Observability and Audit Trail

### Goal

Make dashboard failures and high-impact actions diagnosable.

### Files

- `app/api/jobs/trigger/route.ts`
- `app/api/jobs/trigger-job/route.ts`
- Recommendation mutation routes.
- `lib/dashboard/jobs-status.ts`
- Existing audit log helpers or direct `prisma.auditLog` usage.

### Tasks

1. Add structured server logs for job trigger requests.
   - actor.
   - job name.
   - run ID.
   - result status.
   - duration.

2. Add audit log entries for manual job trigger attempts.
   - success.
   - denied.
   - failed validation.

3. Add dashboard status build metrics.
   - duration.
   - snapshot hit/miss.
   - query failure.

4. Add user-facing correlation where useful.
   - Show run ID in failed job details or copyable debug block.

### Acceptance Criteria

- Failed manual trigger attempts can be traced server-side.
- Users can report a run ID for failed dashboard refreshes.
- Slow status builds are visible in logs.

### Tests

- Route tests for audit log creation on trigger and denied trigger.
- Unit tests for status metadata where applicable.

## Phase 11 - Test Plan

### Unit Tests

- `hooks/use-auth-fetch.ts`
  - Does not attach public API key.
  - Attaches App Bridge bearer token when available.
  - Handles token failure without leaking private auth.

- `components/app-bridge-auth-gate.tsx`
  - Loading state.
  - Error state.
  - Ready state.

- `lib/dashboard/job-registry.ts`
  - All jobs have labels.
  - Triggerable jobs have trigger strategies.
  - Non-triggerable jobs have disabled reasons.

- `lib/dashboard/job-history.ts`
  - Noisy jobs do not starve quiet jobs.

- `lib/dashboard/jobs-status.ts`
  - Snapshot hit/miss behavior.
  - Job health data includes queued/running/stale fields.
  - Latest insight per type.
  - Ad spend period matching.
  - Content lift formatting inputs.

- `lib/dashboard/activity-sparkline.ts`
  - Stable bucket generation using one `now`.
  - Timezone behavior.

- `lib/client-cache.ts`
  - TTL hit.
  - TTL miss.
  - Stale read.
  - Metadata returned.

### API Route Tests

- `/api/jobs/status`
  - Auth required.
  - Snapshot metadata returned.
  - `runId` lookup works.
  - Missing `runId` returns `404`.

- `/api/jobs/trigger`
  - Auth required.
  - Permission required.
  - Returns queued run.
  - Already queued behavior.

- `/api/jobs/trigger-job`
  - Unknown job.
  - Visible but non-triggerable job.
  - Triggerable queued job.
  - Backend failure surfaces error.

- Recommendation approve/reject routes.
  - Permission required.
  - Conflicting status returns `409`.
  - Hard block approval remains blocked.

### Component or Integration Tests

- Dashboard initial load with auth ready.
- Dashboard auth error state.
- Secondary panel error state.
- Stale cache warning.
- Active run polling.
- Pending recommendation action disabling.
- Responsive card wrapping.

### Manual Verification

- Embedded Shopify admin load.
- Direct top-level browser load.
- Narrow viewport.
- Job trigger success.
- Job trigger failure.
- Queue already running.
- Stale cached dashboard after simulated API failure.

## Recommended Parallel Implementation Order

### Wave 0 - Contract Setup

Run first with the coordinating agent and relevant workstream owners.

1. Define auth and permission helper signatures.
2. Add job registry types and a skeleton registry.
3. Define dashboard panel state and cache entry types.
4. Define navigation config types if Phase 9 starts early.
5. Document route response fields required by the UI before implementation begins.

### Wave 1 - Independent Foundations

These can run in parallel after Wave 0.

1. Agent 1: Phase 1 auth boundary and auth gate.
2. Agent 2: Phase 2 job registry and trigger validation.
3. Agent 3: Phase 5 cache and panel state helpers, avoiding final page wiring until response contracts are stable.
4. Agent 4: Phase 7 correctness fixes that do not touch shared job status fields owned by Agent 2.
5. Agent 5: Phase 9 navigation config if the auth layout contract is settled.

### Wave 2 - Dependent Server Work

Run after Wave 1 contracts are available.

1. Agent 1: Phase 4 permission enforcement on mutation routes.
2. Agent 2: Phase 3 durable triggering and run tracking.
3. Agent 2: Phase 6 snapshot strategy and status metadata.
4. Agent 4: Remaining Phase 7 correctness fixes in shared dashboard status code.
5. Agent 2: Phase 10 observability for job trigger and status flows.

### Wave 3 - Dependent Client Work

Run after route response shapes are implemented or mocked in tests.

1. Agent 3: Wire Phase 5 state model into `app/(embedded)/page.tsx`.
2. Agent 5: Phase 8 responsive and accessibility work.
3. Agent 5: Finish Phase 9 layout/provider navigation wiring.
4. Agent 1 and Agent 5: Align permission-disabled UI states with server behavior.
5. Agent 2 and Agent 3: Align run polling UI with status route behavior.

### Wave 4 - Integration and Regression

Run after all workstreams are merged.

1. Agent 6: Phase 11 focused test pass by workstream.
2. Agent 6: Full regression pass.
3. Agent 6: Manual verification checklist.
4. Coordinating agent: Final risk review and release notes.

## Suggested Pull Request Breakdown

### PR 1 - Shared Contracts

- Add auth/permission helper signatures or interfaces.
- Add job registry shell and exported types.
- Add dashboard panel state/cache types.
- Add navigation config types if needed.

### PR 2 - Secure Dashboard Auth

- Remove public API-key browser path.
- Implement real auth gate.
- Add auth tests.

### PR 3 - Job Registry and Trigger Correctness

- Add shared job registry.
- Align job health and manual trigger route.
- Disable unsupported manual jobs.

### PR 4 - Queue-Based Run Tracking

- Queue supported manual jobs.
- Add polling and run status UI.
- Remove fire-and-forget behavior.

### PR 5 - Permissions

- Add permission helper.
- Protect mutation routes.
- Add UI disabled states for restricted users.

### PR 6 - Dashboard Fetch State and Cache

- Add cache TTL metadata.
- Add per-panel loading/error/empty/stale states.
- Add request ordering guard and retry.

### PR 7 - Data Correctness

- Fix job history starvation.
- Fix latest skill insight query.
- Fix ad spend period comparison.
- Fix activity bucket and date formatting issues.

### PR 8 - Responsive and Accessibility

- Replace non-wrapping rows.
- Add sparkline and trend accessibility.
- Fix disclosure labels and conflicting action buttons.

### PR 9 - Navigation and Observability

- Shared nav config.
- Audit/manual trigger logs.
- Slow dashboard status logs.

## Risk Notes

- Removing public API-key auth can break local workflows if they currently rely on `NEXT_PUBLIC_AUTOPILOT_API_KEY`. Replace that with documented server-only scripted access.
- Queueing more jobs requires dispatchers and may expose missing idempotency in existing cron handlers.
- Permission checks require a reliable actor identity. If Shopify user identity is incomplete, start with a conservative server-side allowlist.
- Snapshot-first dashboard status can show slightly stale data. This is acceptable only if freshness is visible and mutations refresh snapshots.

## Definition of Done

- No protected dashboard route depends on a browser-exposed secret.
- Dashboard does not render or fetch before auth is ready.
- Manual job actions are reliable, tracked, and accurately reported.
- Dashboard panels distinguish loading, empty, error, stale, and ready states.
- Cached data has TTL and visible freshness.
- Job health reflects queued, running, stale, failed, never-run, and successful states.
- Dashboard layout works at embedded desktop and narrow widths.
- Sparklines, trend dots, and disclosure controls have accessible alternatives.
- Tests cover auth, permissions, queue behavior, data correctness, and core dashboard UI states.
