# SEO Tasks Workboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan. Sol Medium remains the sole orchestrator and executes one stage at a time.

**Goal:** Add a durable, operator-managed SEO Tasks workboard that records current and future SEO follow-ups, derives readiness from dates and evidence, and exposes a compact dashboard summary without authorizing external actions.

**Architecture:** Add one `SeoFollowUpTask` Prisma model, a small pure domain layer, one service layer, authenticated list/detail routes, a Polaris workboard at `/seo-tasks`, and a dashboard projection. The feature is isolated from Store Tasks, Content Proposals, Recommendations, Shopify writes, Meta writes, and runtime AI.

**Tech Stack:** Next.js 15 App Router, React 18, Shopify Polaris 13, Prisma 6/PostgreSQL, Zod 3, Vitest, Testing Library.

**Approved design:** `docs/superpowers/specs/2026-07-18-seo-tasks-workboard-design.md`

## Model Routing

| Stage | Model | Reasoning | Scope |
|---|---|---:|---|
| Orchestration and acceptance | `gpt-5.6-sol` | medium | Sole controller; assigns stages, checks test evidence, owns commits |
| 1. Data, domain, service, API | `gpt-5.6-terra` | high | Named backend and test files only |
| 2. Workboard UI and dashboard | `gpt-5.6-terra` | medium | Named UI, navigation, dashboard, and test files only |
| 3. Seed script and integration coverage | `gpt-5.6-luna` | high | Named seed and integration-test files only |
| One independent review | `codex-auto-review` | high | Read-only, once after all three stages |
| Final verification | `gpt-5.6-sol` | medium | Approved fixes only, then final gates |

If a worker model is unavailable, Sol Medium performs that stage. No unlisted model may be substituted. Model routing is execution metadata only; no model calls or orchestration code are added to the product.

## Lean Execution Rules

- Use three implementation stages only.
- Write focused failing tests before production code within each stage.
- Run focused tests at the end of each stage; do not perform a separate review round.
- Run one independent read-only review after all stages.
- Sol Medium resolves only concrete review findings, then runs final verification once.
- If a final check fails, return directly to the responsible stage, fix it, and rerun only the failed focused check plus the final gate. Do not restart the review process.
- Commit once per completed stage and once for any final-review fixes.
- Do not create additional plans, design documents, controllers, or general-purpose frameworks.

## Global Constraints

1. No production access, deployment, production migration, production seed, live Shopify write, live Meta write, credential change, permission change, or topical-map activation.
2. Every embedded API handler begins with `const authError = await requireAppAuth(req);` and immediately returns it when present.
3. Every mutation then calls `await requirePermission(req, PERMISSIONS.CONTENT_REVIEW)` before parsing the body or accessing Prisma.
4. All database access imports the shared `prisma` from `@/lib/db`; never instantiate `PrismaClient`.
5. No runtime AI, background scheduler, reminder delivery, or date-triggered database mutation.
6. `ready` means ready for operator review only.
7. No endpoint may mutate Store Tasks, Content Proposals, Recommendations, Shopify, Meta, or topical-map packages.
8. Preserve the five existing `/seo-pillar` command-center jobs; `/seo-tasks` is a separate navigation item.
9. Every mutation uses optimistic concurrency and creates its `AuditLog` record in the same Prisma transaction.
10. No DELETE endpoint, destructive migration, terminal-state reopening, or history truncation.
11. Target URLs are governed Agriko paths; destination links are allowlisted internal paths.
12. Production seeding and deployment are explicit later operations and are not authorized by this plan.

---

## Stage 1: Data, Domain, Service, and API

**Model:** `gpt-5.6-terra`, high reasoning  
**Permitted production files:**

- Create `lib/seo-tasks/contracts.ts`
- Create `lib/seo-tasks/readiness.ts`
- Create `lib/seo-tasks/service.ts`
- Modify `prisma/schema.prisma`
- Create `prisma/migrations/20260718120000_add_seo_follow_up_tasks/migration.sql`
- Create `app/api/seo/tasks/route.ts`
- Create `app/api/seo/tasks/[id]/route.ts`

**Permitted test files:**

- Create `__tests__/lib/seo-tasks/readiness.test.ts`
- Create `__tests__/lib/seo-tasks/service.test.ts`
- Create `__tests__/api/seo-tasks-route.test.ts`
- Create `__tests__/integration/seo-follow-up-tasks.test.ts`

### Task 1.1: Define and test the pure contract

- [ ] Write tests covering all bucket branches:

```ts
expect(deriveSeoTaskBucket(completed, now)).toBe("closed");
expect(deriveSeoTaskBucket(cancelled, now)).toBe("closed");
expect(deriveSeoTaskBucket(futureOpen, now)).toBe("scheduled");
expect(deriveSeoTaskBucket(evidenceReady, now)).toBe("ready");
expect(deriveSeoTaskBucket(noEvidenceRequired, now)).toBe("ready");
expect(deriveSeoTaskBucket(insufficientEvidence, now)).toBe("waiting");
expect(isSeoTaskOverdue(overdueOpen, now)).toBe(true);
```

- [ ] Run the red test:

```bash
npx vitest run __tests__/lib/seo-tasks/readiness.test.ts
```

Expected: failure because the domain files do not exist.

- [ ] In `contracts.ts`, define Zod-backed values and exported types for:
  - task type, priority, owner surface, evidence status, source type, persisted status, derived bucket;
  - list query;
  - create input;
  - `edit`, `update_evidence`, `complete`, and `cancel` actions;
  - bounded string and JSON inputs.
- [ ] In `readiness.ts`, implement pure functions:

```ts
export function deriveSeoTaskBucket(
  task: Pick<SeoTaskState, "status" | "earliestReviewAt" | "requiresEvidence" | "evidenceStatus">,
  now: Date,
): SeoTaskBucket;

export function isSeoTaskOverdue(
  task: Pick<SeoTaskState, "status" | "dueAt">,
  now: Date,
): boolean;

export function buildSeoTaskDedupeKey(input: SeoTaskDedupeInput): string;
```

- [ ] Normalize `targetUrl` using `normalizeGovernedUrl`, then store only pathname, search, and hash.
- [ ] Restrict `destinationPath` to `/seo-pillar`, `/content-pilot`, or `/store-pilot`, with an optional query or fragment.
- [ ] Rerun the focused test and require all cases to pass.

### Task 1.2: Add the model and non-destructive migration

- [ ] Add the exact `SeoFollowUpTask` model from the approved design to `prisma/schema.prisma`.
- [ ] Write an additive migration containing only `CREATE TABLE`, indexes, and the unique constraint.
- [ ] Add an integration test that proves:
  - a complete row can be inserted and read;
  - duplicate `dedupeKey` values are rejected;
  - the compound lookup indexes exist after migration.
- [ ] Verify client generation and migration safety:

```bash
npm run db:generate
npm run verify:prisma-client
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/autopilot_test npm run test:postgres -- __tests__/integration/seo-follow-up-tasks.test.ts
```

Expected: Prisma client is current and the focused PostgreSQL test passes only against `autopilot_test`.

### Task 1.3: Implement transactional service behavior

- [ ] Write service tests for:
  - database-backed counts for all four buckets;
  - pagination and search;
  - deterministic ordering by priority, review date, then ID;
  - create deduplication returning `409` metadata with the existing ID;
  - stale `expectedVersion` returning a conflict;
  - immutable source fields;
  - completion note requirement;
  - evidence-required completion guard;
  - cancellation note requirement;
  - terminal records rejecting further mutations;
  - task and `AuditLog` writes sharing one transaction.
- [ ] Implement:

```ts
export async function listSeoTasks(input: SeoTaskListInput, now: Date): Promise<SeoTaskListResponse>;
export async function getSeoTaskDetail(id: string): Promise<SeoTaskDetail | null>;
export async function createSeoTask(input: CreateSeoTaskInput, actor: string): Promise<CreateSeoTaskResult>;
export async function mutateSeoTask(
  id: string,
  action: SeoTaskMutation,
  actor: string,
  now: Date,
): Promise<MutateSeoTaskResult>;
export async function getSeoTaskSummary(now: Date): Promise<SeoTaskSummary>;
```

- [ ] Use `updateMany({ where: { id, version: expectedVersion } })`, increment `version`, and treat a zero count as a conflict.
- [ ] Keep reads bounded: page size at most 100 and task history at most 100 newest entries.
- [ ] Run:

```bash
npx vitest run __tests__/lib/seo-tasks/service.test.ts
```

Expected: all service behavior passes.

### Task 1.4: Add authenticated routes

- [ ] Write route tests proving:
  - unauthenticated requests stop before validation or Prisma;
  - mutations stop at permission failure before body parsing or Prisma;
  - invalid query/body returns `400`;
  - missing detail returns `404`;
  - duplicate/stale/invalid transition returns `409`;
  - unexpected failures return bounded `500` responses without data leakage.
- [ ] Implement `GET` and `POST` in `app/api/seo/tasks/route.ts`.
- [ ] Implement `GET` and `PATCH` in `app/api/seo/tasks/[id]/route.ts`.
- [ ] Keep routes thin: authenticate, authorize mutations, validate, delegate, map result.
- [ ] Run:

```bash
npx vitest run __tests__/api/seo-tasks-route.test.ts
npm run typecheck
git diff --check
```

Expected: route tests and typecheck pass with no whitespace errors.

### Stage 1 acceptance and commit

- [ ] Sol Medium inspects only the stage diff and the focused test output.
- [ ] Confirm no route calls an external API and no files outside the permitted list changed.
- [ ] Commit:

```bash
git add lib/seo-tasks prisma/schema.prisma prisma/migrations/20260718120000_add_seo_follow_up_tasks app/api/seo/tasks __tests__/lib/seo-tasks __tests__/api/seo-tasks-route.test.ts __tests__/integration/seo-follow-up-tasks.test.ts
git commit -m "feat: add SEO follow-up task service"
```

---

## Stage 2: Workboard UI, Navigation, and Dashboard

**Model:** `gpt-5.6-terra`, medium reasoning  
**Permitted production files:**

- Create `app/(embedded)/(seo-pillar)/seo-tasks/page.tsx`
- Create `app/(embedded)/(seo-pillar)/seo-tasks/components/SeoTaskBoard.tsx`
- Create `app/(embedded)/(seo-pillar)/seo-tasks/components/SeoTaskForm.tsx`
- Create `app/(embedded)/(seo-pillar)/seo-tasks/components/SeoTaskRow.tsx`
- Modify `lib/navigation.ts`
- Modify `lib/dashboard/jobs-status.ts`
- Modify `app/(embedded)/components/dashboard/types.ts`
- Modify `app/(embedded)/components/dashboard/sections/IntelRow.tsx`

**Permitted test files:**

- Create `__tests__/components/seo-tasks-workboard.test.tsx`
- Modify `__tests__/lib/navigation.test.ts`
- Modify `__tests__/lib/dashboard/jobs-status.test.ts`
- Modify `__tests__/lib/dashboard/jobs-status-v3.test.ts`

### Task 2.1: Build the operator workboard

- [ ] Write component tests for:
  - loading skeleton;
  - separate list and count failures;
  - no-task and filter-empty states;
  - bucket/filter changes;
  - expanded detail and bounded history;
  - inline add/edit/evidence forms;
  - confirmation checkbox before complete/cancel;
  - stale-version conflict refresh prompt;
  - text labels accompanying every status color;
  - keyboard-accessible row expansion and actions.
- [ ] Run the red test:

```bash
npx vitest run __tests__/components/seo-tasks-workboard.test.tsx
```

Expected: failure because the page and components do not exist.

- [ ] Build a Polaris `Page` with title `SEO Tasks`, subtitle `Review work when its date and evidence are ready.`, `Add task`, and `Refresh`.
- [ ] Render four bucket controls with API-provided counts: Ready now, Waiting for evidence, Scheduled, Closed.
- [ ] Render one dense list. Each row must show title, priority, task type, target path, cluster/page role, review date, evidence state, and a plain-language bucket reason.
- [ ] Expand details inline; do not add a modal or kanban board.
- [ ] Keep mutation errors attached to the active row/form.
- [ ] Use `useAuthFetch` for every request and refetch counts after successful mutations.
- [ ] Pass the focused component test.

### Task 2.2: Add navigation and dashboard projection

- [ ] Add `{ label: "Tasks", href: "/seo-tasks", match: "prefix", appBridge: true }` below SEO in the SEO Pilot navigation section.
- [ ] Update navigation tests so App Bridge order includes `/seo-tasks` and active matching remains unambiguous.
- [ ] Extend `buildJobsStatusPayload()` with:

```ts
seoTaskSummary: {
  ready: number;
  waiting: number;
  nextScheduledReviewAt: string | null;
};
```

- [ ] Compute the summary through `getSeoTaskSummary(now)`; do not fetch task rows.
- [ ] Add one `SEO Tasks` card to `IntelRow` with Ready, Waiting, next review date, and a link to `/seo-tasks`.
- [ ] Update dashboard mocks and tests to prove the projection matches service summary values.
- [ ] Run:

```bash
npx vitest run \
  __tests__/components/seo-tasks-workboard.test.tsx \
  __tests__/lib/navigation.test.ts \
  __tests__/lib/dashboard/jobs-status.test.ts \
  __tests__/lib/dashboard/jobs-status-v3.test.ts
npm run typecheck
git diff --check
```

Expected: UI, navigation, dashboard, and typecheck pass.

### Stage 2 acceptance and commit

- [ ] Sol Medium inspects the stage diff and focused output once.
- [ ] Confirm the five `/seo-pillar` command-center jobs are unchanged and the dashboard does not request full task rows.
- [ ] Commit:

```bash
git add 'app/(embedded)/(seo-pillar)/seo-tasks' 'app/(embedded)/components/dashboard' lib/navigation.ts lib/dashboard/jobs-status.ts __tests__/components/seo-tasks-workboard.test.tsx __tests__/lib/navigation.test.ts __tests__/lib/dashboard/jobs-status.test.ts __tests__/lib/dashboard/jobs-status-v3.test.ts
git commit -m "feat: add SEO tasks workboard"
```

---

## Stage 3: Seed Script and End-to-End Data Proof

**Model:** `gpt-5.6-luna`, high reasoning  
**Permitted production files:**

- Create `scripts/seed-seo-follow-up-tasks.ts`
- Modify `package.json`

**Permitted test files:**

- Create `__tests__/scripts/seed-seo-follow-up-tasks.test.ts`
- Create `__tests__/integration/seo-tasks-lifecycle.test.ts`

### Task 3.1: Add dry-run-first seed tooling

- [ ] Write tests proving:
  - default invocation reports exactly three planned tasks and performs zero writes;
  - `--apply` inserts exactly three tasks in the test database;
  - a second `--apply` inserts zero and reports three existing tasks;
  - unknown flags fail;
  - a non-test production database requires an additional explicit `--production` flag and still remains outside this plan’s authority.
- [ ] Implement the three records exactly as specified in the approved design.
- [ ] Export the seed records and runner so tests do not need a subprocess.
- [ ] Add:

```json
"seo:seed-tasks": "tsx scripts/seed-seo-follow-up-tasks.ts"
```

- [ ] Run:

```bash
npx vitest run __tests__/scripts/seed-seo-follow-up-tasks.test.ts
npm run seo:seed-tasks
```

Expected: tests pass; the command reports three planned records and explicitly reports zero writes.

### Task 3.2: Prove the local lifecycle

- [ ] Add a PostgreSQL integration test that creates, reads, updates evidence, completes, and reads the matching audit timeline.
- [ ] Prove the dashboard summary and list counts agree for the same injected `now`.
- [ ] Prove terminal tasks cannot be reopened or deleted through the service.
- [ ] Run:

```bash
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/autopilot_test npm run test:postgres -- \
  __tests__/integration/seo-follow-up-tasks.test.ts \
  __tests__/integration/seo-tasks-lifecycle.test.ts
git diff --check
```

Expected: both integration files pass against `autopilot_test`.

### Stage 3 acceptance and commit

- [ ] Sol Medium inspects the stage diff and focused output once.
- [ ] Confirm no seed was applied outside `autopilot_test`.
- [ ] Commit:

```bash
git add scripts/seed-seo-follow-up-tasks.ts package.json __tests__/scripts/seed-seo-follow-up-tasks.test.ts __tests__/integration/seo-tasks-lifecycle.test.ts
git commit -m "feat: seed scheduled SEO follow-ups"
```

---

## One Independent Review

**Model:** `codex-auto-review`, high reasoning, read-only.

- [ ] Review the complete three-stage diff once for:
  - authentication/permission ordering;
  - database and transaction safety;
  - state-machine correctness;
  - external-action isolation;
  - UI accessibility and truthful state;
  - seed dry-run guarantees;
  - scope violations.
- [ ] Return only concrete findings with file, line, severity, and violated requirement.
- [ ] Do not request style-only churn or unrelated refactors.
- [ ] Sol Medium fixes accepted findings in the responsible files and runs the relevant focused test.
- [ ] Do not run a second independent review.
- [ ] If fixes were required, commit once:

```bash
git commit -am "fix: address SEO tasks review findings"
```

Use explicit `git add` paths instead of `-a` if unrelated tracked changes exist.

---

## Final Verification

**Model:** `gpt-5.6-sol`, medium reasoning.

- [ ] Run all automated gates once:

```bash
npm run db:generate
npm run verify:prisma-client
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/autopilot_test npm run test:postgres
npm test
npm run typecheck
npm run typecheck:test
npm run lint
npm run build
git diff --check
```

Expected: every command exits `0`.

- [ ] Start the local app with `npm run dev`.
- [ ] Inspect the authenticated `/seo-tasks` UI at desktop and narrow widths.
- [ ] For every displayed seeded task, trace the row to its API response and persisted `SeoFollowUpTask` record.
- [ ] Exercise add, edit, evidence update, complete, cancel, filter, search, pagination, conflict, empty, and error states against local/test data.
- [ ] Verify the dashboard summary matches `/api/seo/tasks` counts.
- [ ] Verify no Shopify, Meta, model-provider, or topical-map mutation request occurred.
- [ ] Record evidence in the normal task handoff and update `.mex/ROUTER.md` only if durable routing context changed.

The feature may be reported locally complete only after all checks above pass. Stop before production migration, seed, push, or deployment and request explicit operator authority for those separate actions.

