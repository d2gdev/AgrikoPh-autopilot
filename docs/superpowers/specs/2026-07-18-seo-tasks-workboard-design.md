# SEO Tasks Workboard Design

**Date:** 2026-07-18
**Status:** Approved for implementation planning
**Owner surface:** SEO Pilot
**Register:** Product

## 1. Problem

SEO follow-ups currently live across Search Console, topical-map evidence, Content Pilot, Store Tasks, project records, and operator conversations. The operator must remember which work is actionable now, which work is waiting for evidence, and which work cannot be reviewed until a future date.

The plugin needs one durable operator surface that records this timing and evidence state without turning a date into execution authority or duplicating the existing Content Pilot and Store Task queues.

## 2. Decision

Build a dedicated `/seo-tasks` workboard inside the SEO Pilot navigation.

Do not add a sixth tab to `/seo-pillar`. The current SEO command center deliberately exposes exactly five jobs, and the workboard is an operational schedule rather than a new command-center analysis job.

Persist workboard records in a new `SeoFollowUpTask` model. Do not reuse:

- `StoreTask`, which represents reviewed store work and may connect to execution;
- `ContentProposal`, which owns content drafting and publishing;
- `Opportunity`, which represents detected opportunities rather than scheduled follow-up;
- `Notification`, which is an alert feed rather than durable task state.

The workboard may link to those surfaces, but it never changes their records or invokes their actions.

## 3. Alternatives Considered

### A. Dedicated model and SEO Tasks screen

This is the selected approach. It supports dated follow-ups, evidence thresholds, decision history, auditability, deduplication, and operator-managed tasks without weakening another lifecycle.

### B. Derive the screen only from Store Tasks and Content Proposals

Rejected. It cannot represent experiment reviews, canonical-transfer monitoring, indexing checks, or cohort review dates without creating misleading executable records.

### C. Keep the schedule in Markdown or project memory

Rejected. It is not visible in the embedded app, cannot be filtered or audited by the operator, and does not provide one persisted product truth.

## 4. Scope

### Included in version 1

- A separate `/seo-tasks` page under the SEO Pilot navigation.
- Durable create, edit, evidence-update, complete, and cancel lifecycles.
- Deterministic buckets: Ready now, Waiting for evidence, Scheduled, and Closed.
- Search, priority filtering, task-type filtering, pagination, and truthful counts.
- Exact target URL, topical cluster, page role, earliest review date, optional due date, evidence requirement, evidence snapshot, source, and destination surface.
- Optimistic concurrency for every mutation.
- AuditLog entries written atomically with every mutation.
- An idempotent, dry-run-first seed script for the three already agreed dated follow-ups.
- A small Dashboard summary linking to `/seo-tasks`, but no duplicate task list.

### Excluded from version 1

- Automatic Search Console collection or evidence scoring.
- AI-generated readiness decisions.
- Background schedulers or reminder delivery.
- Email, SMS, or external calendar integration.
- Automatic creation of Content Proposals, Store Tasks, Recommendations, or Shopify changes.
- Automatic reopening of completed or cancelled tasks.
- Topical-map package mutation or activation.
- Changes to the five existing `/seo-pillar` command-center tabs.

## 5. Data Model

Add `SeoFollowUpTask`:

```prisma
model SeoFollowUpTask {
  id                  String    @id @default(cuid())
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  version             Int       @default(1)
  taskType            String
  title               String
  description         String
  targetUrl           String?
  topicalCluster      String?
  pageRole            String?
  ownerSurface        String    @default("seo")
  destinationPath     String?
  priority            String
  earliestReviewAt    DateTime
  dueAt               DateTime?
  requiresEvidence    Boolean   @default(true)
  evidenceRequirement Json
  evidenceStatus      String    @default("waiting")
  evidenceSnapshot    Json?
  lastEvaluatedAt     DateTime?
  sourceType          String
  sourceKey           String
  sourceData          Json
  status              String    @default("open")
  createdBy           String
  updatedBy           String
  completedAt         DateTime?
  completionNote      String?
  decisionData        Json?
  dedupeKey           String    @unique

  @@index([status, earliestReviewAt])
  @@index([priority, earliestReviewAt])
  @@index([taskType, status])
  @@index([targetUrl])
}
```

The application validates string fields with Zod. Version 1 intentionally avoids Prisma enums to match the repository’s existing task models while still rejecting unknown values at every API boundary.

### Allowed values

`taskType`:

- `canonical_transfer_review`
- `ctr_experiment_review`
- `indexation_review`
- `content_quality_review`
- `cohort_review`
- `technical_review`
- `other`

`priority`:

- `P0`
- `P1`
- `P2`
- `P3`

`ownerSurface`:

- `seo`
- `content`
- `store`

`evidenceStatus`:

- `waiting`
- `insufficient`
- `sufficient`
- `not_required`

`sourceType`:

- `operator`
- `seo_experiment`
- `topical_map`
- `system`

`status`:

- `open`
- `completed`
- `cancelled`

## 6. Deterministic Bucket Rules

Bucket selection is a pure function of a task and an injected `now`.

1. `status` equal to `completed` or `cancelled` returns `closed`.
2. An open task with `earliestReviewAt > now` returns `scheduled`.
3. An open task whose review date has arrived returns `ready` only when:
   - `requiresEvidence` is false and `evidenceStatus` is `not_required`; or
   - `requiresEvidence` is true and `evidenceStatus` is `sufficient`.
4. Every other open task returns `waiting`.

`dueAt` never affects readiness. It adds an overdue label only.

Crossing `earliestReviewAt` does not update the database. The read model derives the bucket at request time. There is no scheduler and no date-triggered mutation.

## 7. Mutation Rules

- Every embedded handler calls `await requireAppAuth(req)` as its first statement.
- Every mutation immediately calls `await requirePermission(req, PERMISSIONS.CONTENT_REVIEW)` before parsing input or touching the database.
- Every mutation includes `expectedVersion`.
- Mutations use `updateMany({ where: { id, version: expectedVersion } })` and increment `version`. A zero count returns `409`.
- Create rejects a duplicate `dedupeKey` with `409` and returns the existing task ID. It never reopens a closed task.
- Immutable after creation: `sourceType`, `sourceKey`, and `dedupeKey`.
- Completion requires a non-blank completion note.
- If `requiresEvidence` is true, completion also requires `evidenceStatus: "sufficient"` and a non-null `evidenceSnapshot`.
- Cancellation requires a non-blank note and retains the row.
- No DELETE endpoint exists.
- The task mutation and matching `AuditLog` row are written in the same Prisma transaction.
- No mutation calls Shopify, Meta, Content Pilot publishing, Store Task apply/execute, topical-map activation, a model provider, or an external API.

## 8. API Contract

### `GET /api/seo/tasks`

Authenticated read. Query parameters:

- `bucket`: `ready | waiting | scheduled | closed`
- `priority`: `all | P0 | P1 | P2 | P3`
- `taskType`: `all` or one allowed type
- `q`: at most 200 characters
- `page`: integer from 1
- `pageSize`: integer from 1 through 100

Response:

```ts
type SeoTaskListResponse = {
  tasks: SeoTaskListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: {
    ready: number;
    waiting: number;
    scheduled: number;
    closed: number;
  };
  asOf: string;
};
```

List items exclude unbounded audit history and include only bounded evidence summaries.

### `POST /api/seo/tasks`

Creates one operator task. Requires `CONTENT_REVIEW`. The server derives `dedupeKey` from normalized semantic fields; clients cannot supply it.

### `GET /api/seo/tasks/[id]`

Returns the exact task plus its SEO-task AuditLog timeline, bounded to 100 newest entries.

### `PATCH /api/seo/tasks/[id]`

Requires `CONTENT_REVIEW`. Accepts one discriminated action:

- `edit`
- `update_evidence`
- `complete`
- `cancel`

The service owns transition validation; the route only authenticates, validates, delegates, and bounds the response.

## 9. URL and Link Safety

- `targetUrl` is normalized with the existing topical-map governed-URL helper and stored as a relative path.
- `destinationPath` must be one of `/seo-pillar`, `/content-pilot`, or `/store-pilot`, optionally with a query string or fragment.
- The UI never renders arbitrary URLs from `sourceData`.
- External evidence references remain plain bounded text in version 1.

## 10. Interface

The physical scene is an Agriko operator working in Shopify Admin during a daytime review session, moving quickly between evidence and approvals. The interface therefore uses the existing light Polaris product vocabulary and restrained semantic color.

### Page structure

- Page title: `SEO Tasks`
- Subtitle: `Review work when its date and evidence are ready.`
- Primary action: `Add task`
- Secondary action: `Refresh`
- Four bucket controls with truthful counts.
- Search, priority, and task-type filters.
- A single dense list, not a grid of identical cards.
- Rows show title, priority, task type, target path, cluster/page role, review date, evidence state, and why the row is in its bucket.
- Selecting a row expands an inline detail region with full description, evidence requirement, evidence snapshot, source, destination link, and decision history.
- Add and edit use inline forms. No modal is required.

### Required states

- Initial loading uses skeletons.
- A failed active list and a failed count summary are reported separately.
- Empty state distinguishes no tasks from filters hiding tasks.
- Mutation errors stay attached to the expanded row or form.
- Completion and cancellation use explicit confirmation checkboxes in the inline form.
- Status is never communicated by color alone.
- Keyboard navigation, visible focus, semantic headings, and WCAG 2.1 AA are required.

## 11. Dashboard Summary

Add one compact SEO Tasks summary to the existing dashboard:

- Ready now count
- Waiting count
- Next scheduled review date
- Link to `/seo-tasks`

The dashboard never fetches full task rows and never exposes mutation actions.

## 12. Initial Seed Records

The seed script is dry-run by default and writes only with `--apply`.

### Canonical comparison transfer

- Task type: `canonical_transfer_review`
- Priority: `P1`
- Target: `/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice-is-right-for-you`
- Cluster: `rice-nutrition`
- Page role: `comparison`
- Earliest review: `2026-07-25T00:00:00+08:00`
- Due: `2026-08-01T23:59:59+08:00`
- Evidence: Google-selected canonical, index status, legacy impressions, canonical impressions, clicks, and enhancement detection.

### Rice Nutrition CTR pilot

- Task type: `ctr_experiment_review`
- Priority: `P1`
- Target: `/blogs/news/rice-nutrition-breakdown`
- Cluster: `rice-nutrition`
- Page role: `nutrition-pillar`
- Earliest review: `2026-07-29T00:00:00+08:00`
- Evidence window: finalized `2026-07-14` through `2026-07-27`
- Evidence: clicks, impressions, CTR, average position, query mix, and confirmed Google crawl date.

### Recipe cohort review

- Task type: `cohort_review`
- Priority: `P2`
- Target: `/blogs/recipes`
- Cluster: `recipes`
- Page role: `recipe-index`
- Earliest review: `2026-09-22T00:00:00+08:00`
- Evidence: 90-day recipe cohort clicks, impressions, landing sessions, conversions, indexed coverage, and page-level outliers.

The seed command does not run during migration or deployment. Production seeding requires separate explicit operator authority.

## 13. Development Model Routing

This routing applies to implementation work only. It does not add any model call to the production feature.

### Orchestrator

`gpt-5.6-sol` with `medium` reasoning is the sole orchestrator for the entire plan.

Sol Medium:

- selects exactly one plan task at a time;
- supplies the task’s exact files, interfaces, constraints, and prior verified outputs;
- rejects scope expansion;
- requires fresh red-green evidence;
- reviews diffs before accepting a task;
- controls all commits;
- never delegates production access or protected actions.

### Worker and reviewer assignments

| Stage | Model | Reasoning | Permission |
|---|---|---:|---|
| Contract, state machine, Prisma design | `gpt-5.6-terra` | high | Workspace write, named files only |
| Service and authenticated API implementation | `gpt-5.6-terra` | high | Workspace write, named files only |
| Polaris UI and accessibility | `gpt-5.6-terra` | medium | Workspace write, named files only |
| Seed tooling and dashboard projection | `gpt-5.6-luna` | high | Workspace write, named files only |
| Independent task review | `codex-auto-review` | high | Read-only |
| Integration, final verification, completion decision | `gpt-5.6-sol` | medium | Workspace write only for approved fixes |

If a requested model is unavailable, Sol Medium performs the task itself. It must not silently substitute an unlisted model.

The removed `codex:loop` controller is not reintroduced. Model routing is enforced by the execution session or compatible orchestration tooling, not by production code or a new repository controller.

## 14. Strict Global Constraints

1. No production access, deployment, production migration, production seed, live Shopify write, live Meta write, credential change, permission change, or topical-map activation is authorized by this specification or its plan.
2. No runtime AI or model call is allowed in the SEO Tasks feature.
3. No background scheduler is added.
4. Dates and elapsed time never authorize an external action.
5. `ready` means ready for human review only.
6. The feature may link to another pilot but may not mutate another pilot’s records.
7. The five existing SEO command-center jobs remain unchanged.
8. Every API read is authenticated; every API mutation is authenticated, permission-gated, validated, audited, and optimistic-concurrency protected.
9. Every database access uses `import { prisma } from "@/lib/db"`.
10. No `PrismaClient` instance is created outside the existing database module.
11. No destructive migration, row deletion, history truncation, or terminal-state reopening.
12. No arbitrary external URL rendering from persisted JSON.
13. No hidden task cap; pagination totals are database-backed.
14. No status inference from color alone.
15. No task is reported complete without a persisted task row, matching AuditLog row, and fresh verification.

## 15. Verification and Acceptance

The feature is locally complete only when:

- pure bucket tests cover every date/evidence/status combination;
- API tests prove auth-first and permission-first behavior;
- mutation tests prove malformed input, duplicate keys, optimistic conflicts, invalid transitions, required completion evidence, and atomic AuditLog writes;
- PostgreSQL integration tests run only against `autopilot_test`;
- navigation and responsive UI tests pass;
- the dashboard summary and full workboard return consistent counts;
- the initial seed dry run reports exactly three planned tasks and performs zero writes;
- the second seed apply against the test database creates zero duplicates;
- Prisma generation/freshness, focused tests, PostgreSQL tests, full tests, typechecks, lint, build, and diff hygiene pass;
- authenticated local UI inspection verifies every displayed task and action against its API response and persisted record.

Production deployment and production seed remain separate, explicitly authorized operations with their own verification gates.
