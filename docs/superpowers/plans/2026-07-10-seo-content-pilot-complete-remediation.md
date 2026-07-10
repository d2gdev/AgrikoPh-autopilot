# SEO Pilot and Content Pilot Complete Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Resolve every F01–F18 finding in the approved SEO Pilot and Content Pilot remediation design while preserving every feature and the approval-first Shopify safety model.

**Architecture:** Keep the existing Next.js, Prisma, Polaris, and AI boundaries. Add focused shared services for durable generation ownership, transactional proposal transitions, publish claim/receipt/finalization/reconciliation, PostgreSQL-safe canonical creation, GA4 arbitration, and paginated queue reads. All schema changes are additive; manual, scheduled, and maintenance paths share the same domain rules.

**Tech Stack:** Next.js 15.5 App Router, TypeScript 5.6, React 18, Shopify Polaris 13, Prisma 6.19/PostgreSQL 16, Vitest 4, Zod 3, OpenAI-compatible DeepSeek/OpenRouter client, GitHub Actions.

## Global Constraints

- Execute this plan only in /home/sean/Agriko/auto-pilot-seo-content-complete-remediation on branch seo-content-complete-remediation.
- Never rebuild the application from scratch and never disable, remove, or defer an affected feature.
- Never execute live Shopify, Meta, production database, deployment, migration, publishing, or SSH actions during implementation or verification.
- Preserve requireAppAuth/requirePermission as the first embedded-handler statement and requireCronAuth followed by acquireJobLock in cron routes.
- Preserve CONTENT_REVIEW for review/content mutations and CONTENT_PUBLISH for scheduling, reconciliation, maintenance republishing, and live writes.
- Preserve approved/override_approved publish predicates, rejection safety, cron job locks, guardrails, and pause_ad exclusion from CONVERSION_SENSITIVE_ACTIONS.
- Use import { prisma } from "@/lib/db" for database access; transaction-aware helpers receive a client derived from that singleton.
- Use red-green TDD for every behavior change. Record the failing command/output before implementation and the passing command/output after it.
- Dispatch a fresh implementation subagent for each task. After implementation, dispatch the skill-required specification reviewer and then code-quality reviewer. Resolve every review finding before continuing.
- Run the task's focused verification, project Verify Checklist items affected by the task, GROW, and commit after every task.
- Preserve unrelated worktree changes. If unexpected changes appear, stop and identify their owner before editing.
- No traceability row F01–F18 may remain open at final verification.

---

## File and Responsibility Map

### New shared runtime files

- lib/content-pilot/proposal-transitions.ts — atomic approve/reject/reopen/edit/schedule transactions.
- lib/content-pilot/generation-service.ts — durable generation claim, conditional completion/failure, validation, and history.
- lib/content-pilot/publish-service.ts — publish claim, fresh read, Shopify call, durable receipt, finalization, warnings, and typed outcomes.
- lib/content-pilot/publish-reconciliation.ts — proposal-type-specific inspection of uncertain Shopify outcomes.
- lib/content-pilot/proposal-replacement.ts — transactional pending replacement plus Opportunity transitions.
- lib/content-pilot/queue-query.ts — validation and stable server-side pagination/filter/sort contracts.
- lib/seo/ga4-selection.ts — pure normalized/raw GA4 arbitration.
- scripts/check-prisma-client.mjs — generated-client freshness check.
- scripts/postgres-test-guard.mjs — rejects production-looking integration URLs.
- vitest.postgres.config.ts — isolated serial PostgreSQL integration configuration.

### New test files

- __tests__/api/content-pilot-permissions.test.ts
- __tests__/api/content-pilot-regenerate-filipino.test.ts
- __tests__/api/content-pilot-pagination.test.ts
- __tests__/lib/content-pilot/proposal-transitions.test.ts
- __tests__/lib/content-pilot/generation-service.test.ts
- __tests__/lib/content-pilot/publish-service.test.ts
- __tests__/lib/content-pilot/proposal-replacement.test.ts
- __tests__/lib/content-pilot/queue-query.test.ts
- __tests__/lib/seo/ga4-selection.test.ts
- __tests__/scripts/check-prisma-client.test.ts
- __tests__/scripts/postgres-test-guard.test.ts
- __tests__/integration/postgres/content-proposal-races.test.ts
- __tests__/integration/postgres/content-proposal-migrations.test.ts
- __tests__/integration/postgres/proposal-transactions.test.ts

### Existing route/UI files remain entry points

Routes under app/api/content-pilot and app/api/seo become thin authorization, validation, and service-adapter layers. QueueTab remains the queue UI owner but consumes server pagination and extracted pure bulk-result helpers. No route or page is replaced.

---

### Task 1: Establish Explicit Prisma and Non-Production PostgreSQL Gates

**Findings:** F12 foundation, F17 foundation

**Files:**
- Create: scripts/check-prisma-client.mjs
- Create: scripts/postgres-test-guard.mjs
- Create: vitest.postgres.config.ts
- Create: __tests__/scripts/check-prisma-client.test.ts
- Create: __tests__/scripts/postgres-test-guard.test.ts
- Modify: package.json
- Modify: .github/workflows/ci.yml

**Interfaces:**
- Produces: checkPrismaClientFreshness({ rootDir }): { current: boolean; expectedHash: string; actualHash: string | null }.
- Produces: assertNonProductionDatabaseUrl(url, options?): void.
- Produces scripts: verify:prisma-client and test:postgres.
- Later PostgreSQL tasks use DATABASE_URL_TEST and vitest.postgres.config.ts.

- [ ] **Step 1: Write failing generated-client freshness tests**

Create a temporary fixture with schema.prisma, package files, and a missing or mismatched stamp:

~~~ts
it("reports a reused stale Prisma client before typecheck", () => {
  const fixture = makeFixture({ stampHash: "old" });
  expect(checkPrismaClientFreshness({ rootDir: fixture })).toMatchObject({
    current: false,
    actualHash: "old",
  });
});

it("accepts the exact schema/package hash", () => {
  const fixture = makeFixture();
  writeMatchingStamp(fixture);
  expect(checkPrismaClientFreshness({ rootDir: fixture }).current).toBe(true);
});
~~~

- [ ] **Step 2: Write failing database guard tests**

~~~ts
it.each([
  "postgresql://user:pass@prod.example.com/autopilot",
  "postgresql://user:pass@10.0.0.9/autopilot",
])("rejects non-local database %s", (url) => {
  expect(() => assertNonProductionDatabaseUrl(url)).toThrow(/non-production/i);
});

it.each([
  "postgresql://test:test@127.0.0.1:5432/autopilot_test",
  "postgresql://test:test@localhost:5432/autopilot_test",
])("accepts local test database %s", (url) => {
  expect(() => assertNonProductionDatabaseUrl(url)).not.toThrow();
});
~~~

- [ ] **Step 3: Run Task 1 tests and verify RED**

Run:

~~~bash
npm test -- --run __tests__/scripts/check-prisma-client.test.ts __tests__/scripts/postgres-test-guard.test.ts
~~~

Expected: FAIL because both script modules are absent.

- [ ] **Step 4: Implement the hash and URL guards**

Use the same SHA-256 input order as scripts/build-next.mjs: prisma/schema.prisma, package.json, package-lock.json. The check command exits nonzero with npm run db:generate guidance when the stamp is absent or stale.

The database guard accepts localhost/127.0.0.1 by default and CI service host postgres only when CI === "true" and ALLOW_CI_POSTGRES === "true". It rejects missing URLs, production database names, and every other host.

- [ ] **Step 5: Add explicit scripts and CI ordering**

Add package scripts:

~~~json
"verify:prisma-client": "node scripts/check-prisma-client.mjs",
"test:postgres": "vitest run --config vitest.postgres.config.ts"
~~~

Update CI order to:

~~~yaml
- name: Generate Prisma Client
  run: npm run db:generate
- name: Verify Prisma Client
  run: npm run verify:prisma-client
- name: Typecheck application
  run: npm run typecheck
- name: Typecheck tests
  run: npm run typecheck:test
~~~

Add a PostgreSQL 16 service with database autopilot_test, health checks, and a later test:postgres step. Do not add a production or secret URL.

- [ ] **Step 6: Run Task 1 verification**

~~~bash
npm run db:generate
npm run verify:prisma-client
npm test -- --run __tests__/scripts/check-prisma-client.test.ts __tests__/scripts/postgres-test-guard.test.ts
npm run typecheck
npm run typecheck:test
~~~

Expected: all commands exit 0.

- [ ] **Step 7: Run GROW and commit Task 1**

Record explicit Prisma generation and local-only PostgreSQL testing in the relevant setup/conventions scaffold if facts changed.

~~~bash
git add scripts/check-prisma-client.mjs scripts/postgres-test-guard.mjs vitest.postgres.config.ts __tests__/scripts/check-prisma-client.test.ts __tests__/scripts/postgres-test-guard.test.ts package.json package-lock.json .github/workflows/ci.yml .mex
git commit -m "test: establish Prisma and PostgreSQL verification gates"
~~~

---

### Task 2: Enforce Content Permissions and Normalize Reopen State

**Findings:** F02, F14

**Files:**
- Create: __tests__/api/content-pilot-permissions.test.ts
- Modify: __tests__/api/rbac-routes.test.ts
- Modify: __tests__/api/content-pilot-reject-route.test.ts
- Modify: __tests__/lib/content-pilot/proposal-state.test.ts
- Modify: lib/content-pilot/proposal-state.ts
- Modify: app/api/content-pilot/proposals/[id]/reject/route.ts
- Modify: app/api/content-pilot/proposals/[id]/reopen/route.ts
- Modify: app/api/content-pilot/proposals/[id]/clone/route.ts
- Modify: app/api/content-pilot/proposals/[id]/generate-draft/route.ts
- Modify: app/api/content-pilot/proposals/[id]/route.ts
- Modify: app/api/content-pilot/proposals/generate/route.ts
- Modify: app/api/content-pilot/proposals/manual/route.ts
- Modify: app/api/content-pilot/proposals/refresh-all/route.ts
- Modify: app/api/seo/promote/route.ts
- Modify: app/api/seo/gaps/promote/route.ts
- Modify: app/api/seo/recommendations/decompose/route.ts

**Interfaces:**
- Produces: CONTENT_PROPOSAL_PUBLISHABLE_STATUSES unchanged as approved and override_approved.
- Produces: isContentProposalStatusPublishable(status), canGenerateContentProposal(proposal), canEditContentProposal(proposal), and reopenedContentProposalState().
- All listed mutation routes use requirePermission(req, PERMISSIONS.CONTENT_REVIEW) first.

- [ ] **Step 1: Write the table-driven forbidden-route test**

For every listed mutation, mock requirePermission to return a 403 response and assert no Prisma, AI, or Shopify boundary is called:

~~~ts
it.each(contentReviewMutations)("blocks %s without content:review", async (_name, invoke) => {
  mockAuth.requirePermission.mockResolvedValue(
    Response.json({ error: "Forbidden", permission: "content:review" }, { status: 403 }),
  );
  const response = await invoke();
  expect(response.status).toBe(403);
  expect(mockPrismaCalls()).toBe(0);
  expect(mockGenerateDraft).not.toHaveBeenCalled();
  expect(mockPublishDraft).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Write state and reopen regressions**

~~~ts
it("returns a coherent pending state when reopening", () => {
  expect(reopenedContentProposalState()).toEqual({
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    draftStatus: null,
    draftContent: Prisma.JsonNull,
    draftError: null,
    draftGeneratedAt: null,
    citations: Prisma.JsonNull,
    scheduledPublishAt: null,
    draftGenerationToken: null,
    draftGenerationStartedAt: null,
    publishOperationId: null,
    publishStartedAt: null,
    publishFinalizedAt: null,
    publishWarning: null,
  });
});
~~~

Also assert edit/generate/schedule/publish predicates require approved or override_approved as specified.

- [ ] **Step 3: Run Task 2 tests and verify RED**

~~~bash
npm test -- --run __tests__/api/content-pilot-permissions.test.ts __tests__/api/rbac-routes.test.ts __tests__/api/content-pilot-reject-route.test.ts __tests__/lib/content-pilot/proposal-state.test.ts
~~~

Expected: permission tests show requireAppAuth-only routes and reopen leaves draftStatus rejected.

- [ ] **Step 4: Implement permission and pure state changes**

Replace only mutation auth gates; read handlers keep requireAppAuth. Use requirePermission as the first handler statement. Add the pure transition predicates and reopen reset builder. Do not yet introduce transaction helpers; Task 3 owns database atomicity.

- [ ] **Step 5: Run focused route/state verification**

~~~bash
npm test -- --run __tests__/api/content-pilot-permissions.test.ts __tests__/api/rbac-routes.test.ts __tests__/api/content-pilot-reject-route.test.ts __tests__/lib/content-pilot/proposal-state.test.ts __tests__/api/seo-pilot-routes.test.ts
npm run typecheck
~~~

Expected: pass.

- [ ] **Step 6: Run GROW and commit Task 2**

Update the authorization/current-state documentation and bump changed scaffold dates.

~~~bash
git add lib/content-pilot/proposal-state.ts app/api/content-pilot app/api/seo __tests__/api/content-pilot-permissions.test.ts __tests__/api/rbac-routes.test.ts __tests__/api/content-pilot-reject-route.test.ts __tests__/lib/content-pilot/proposal-state.test.ts .mex
git commit -m "fix: enforce Content Pilot mutation permissions"
~~~

---

### Task 3: Add Durable Lifecycle Fields and Atomic Proposal Transitions

**Findings:** F10, F14; schema foundation for F05 and F06

**Files:**
- Create: prisma/migrations/20260710200000_add_content_proposal_operation_state/migration.sql
- Create: lib/content-pilot/proposal-transitions.ts
- Create: __tests__/lib/content-pilot/proposal-transitions.test.ts
- Create: __tests__/prisma/content-proposal-operation-state-migration.test.ts
- Modify: prisma/schema.prisma
- Modify: app/api/content-pilot/proposals/[id]/approve/route.ts
- Modify: app/api/content-pilot/proposals/[id]/reject/route.ts
- Modify: app/api/content-pilot/proposals/[id]/reopen/route.ts
- Modify: app/api/content-pilot/proposals/[id]/route.ts
- Modify: app/api/content-pilot/proposals/[id]/schedule/route.ts
- Modify: __tests__/api/content-pilot-reject-route.test.ts
- Modify: __tests__/api/content-pilot-routes.test.ts

**Interfaces:**
- Adds nullable ContentProposal fields defined by the approved design.
- Produces: approveProposal(tx, input), rejectProposal(tx, input), reopenProposal(tx, input), editProposalDraft(tx, input), and scheduleProposal(tx, input).
- Each function returns { proposal } or throws ContentProposalConflictError.

- [ ] **Step 1: Write the migration source regression**

Assert the migration only adds nullable fields/indexes and never updates approval, draft content, review, schedule, or published values:

~~~ts
for (const column of [
  "draftGenerationToken", "draftGenerationStartedAt", "publishOperationId",
  "publishStartedAt", "publishFinalizedAt", "publishWarning",
]) expect(sql).toContain(`ADD COLUMN "${column}"`);
expect(sql).not.toMatch(/UPDATE\s+"ContentProposal"/i);
~~~

- [ ] **Step 2: Write transaction rollback tests**

Model a transaction client and reject audit/Opportunity/history writes. Assert the transaction rejects and no root-client state mutation occurs outside the callback. Cover approve, reject, reopen, edit, and schedule.

~~~ts
it("rolls back rejection when the Opportunity transition fails", async () => {
  tx.opportunity.updateMany.mockRejectedValue(new Error("opportunity unavailable"));
  await expect(rejectProposal(tx, input)).rejects.toThrow("opportunity unavailable");
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 3: Run Task 3 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/content-pilot/proposal-transitions.test.ts __tests__/api/content-pilot-reject-route.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/prisma/content-proposal-operation-state-migration.test.ts
~~~

Expected: missing migration test/helper modules and non-atomic route behavior.

- [ ] **Step 4: Add the schema and forward migration**

Add:

~~~prisma
draftGenerationToken     String?
draftGenerationStartedAt DateTime?
publishOperationId       String?   @unique
publishStartedAt         DateTime?
publishFinalizedAt       DateTime?
publishWarning           String?
~~~

The SQL uses nullable columns and a unique partial-compatible PostgreSQL index for publishOperationId. Do not change existing rows.

- [ ] **Step 5: Implement transaction helpers**

Each helper receives a transaction client, uses updateMany or a unique conditional update for optimistic state, throws a typed 409 conflict when count is zero, and performs mandatory audit/history/Opportunity writes in that same transaction.

Routes call:

~~~ts
const proposal = await prisma.$transaction((tx) =>
  rejectProposal(tx, { id, reviewedBy, reviewNote }),
);
return NextResponse.json({ proposal });
~~~

No route performs mandatory state writes before or after the transaction.

- [ ] **Step 6: Generate Prisma and run Task 3 verification**

~~~bash
npm run db:generate
npm run verify:prisma-client
npm test -- --run __tests__/lib/content-pilot/proposal-transitions.test.ts __tests__/api/content-pilot-reject-route.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/prisma/content-proposal-operation-state-migration.test.ts
npm run typecheck
~~~

Expected: pass.

- [ ] **Step 7: Run GROW and commit Task 3**

~~~bash
git add prisma/schema.prisma prisma/migrations/20260710200000_add_content_proposal_operation_state lib/content-pilot/proposal-transitions.ts app/api/content-pilot/proposals __tests__/lib/content-pilot/proposal-transitions.test.ts __tests__/api/content-pilot-reject-route.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/prisma/content-proposal-operation-state-migration.test.ts .mex
git commit -m "fix: make Content Pilot transitions atomic"
~~~

---

### Task 4: Add Durable Draft Generation Ownership

**Findings:** F06

**Files:**
- Create: lib/content-pilot/generation-service.ts
- Create: __tests__/lib/content-pilot/generation-service.test.ts
- Modify: app/api/content-pilot/proposals/[id]/generate-draft/route.ts
- Modify: app/api/content-pilot/proposals/route.ts
- Modify: __tests__/api/content-pilot-draft-citations.test.ts
- Modify: __tests__/api/embedded-fallback-auth-routes.test.ts

**Interfaces:**
- Produces: generateProposalDraft({ prismaClient, proposalId, actor, preservePublishedReceipt? }): Promise<GenerateProposalDraftResult>.
- Result is one of ready, failed, discarded, or conflict with safe error fields.
- Uses injected generateDraftImpl, fetchArticlesImpl, and collectCitationsImpl in tests; production defaults use existing modules.

- [x] **Step 1: Write generation ownership tests**

Cover claim token persistence, successful conditional completion, conditional failure, and reject invalidation:

~~~ts
it("discards a late AI result after rejection clears its token", async () => {
  tx.contentProposal.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 0 });
  const result = await generateProposalDraft(input);
  expect(result).toEqual({ status: "discarded", reason: "proposal_changed" });
  expect(tx.contentProposalDraftHistory.create).not.toHaveBeenCalled();
});
~~~

Also prove history failure rolls back ready state and published-preserving maintenance generation does not erase the prior live receipt while AI runs.

- [x] **Step 2: Run Task 4 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts __tests__/api/content-pilot-draft-citations.test.ts __tests__/api/embedded-fallback-auth-routes.test.ts
~~~

Expected: generation-service module absent and current completion update matches only ID.

- [x] **Step 3: Implement claim and conditional completion**

Claim predicate includes proposal ID, approved/override_approved status, no active publishing, and no active generation token. Store randomUUID(), generation start time, and visible generating status unless preservePublishedReceipt is true.

The completion transaction updates only:

~~~ts
where: {
  id: proposalId,
  status: { in: [...CONTENT_PROPOSAL_PUBLISHABLE_STATUSES] },
  draftGenerationToken: token,
}
~~~

It writes ready content and history atomically. Failure writes are conditional on the same token. Citation persistence remains isolated and returns a warning, not a failed draft.

- [x] **Step 4: Remove unsafe time-only publishing recovery**

Delete the generate-draft route branch that changes stale publishing to ready after two minutes. Generating recovery requires both a stale start time and token-aware conditional update; it never overwrites a newer operation.

- [x] **Step 5: Make the route a thin service adapter**

Keep permission and rate limiting at the route. Map ready to 200, discarded/conflict to 409, validation failures to 422, provider failures to their typed status, and safe details to the existing UI error shape.

- [x] **Step 6: Run Task 4 verification**

~~~bash
npm test -- --run __tests__/lib/content-pilot/generation-service.test.ts __tests__/api/content-pilot-draft-citations.test.ts __tests__/api/embedded-fallback-auth-routes.test.ts __tests__/api/content-pilot-reject-route.test.ts
npm run typecheck
~~~

Expected: pass.

- [x] **Step 7: Run GROW and commit Task 4**

~~~bash
git add lib/content-pilot/generation-service.ts app/api/content-pilot/proposals __tests__/lib/content-pilot/generation-service.test.ts __tests__/api/content-pilot-draft-citations.test.ts __tests__/api/embedded-fallback-auth-routes.test.ts .mex
git commit -m "fix: own draft generation with durable tokens"
~~~

---

### Task 5: Unify Publish Claim, Receipt, Finalization, and Reconciliation

**Findings:** F03, F04, F05

**Files:**
- Create: lib/content-pilot/publish-service.ts
- Create: lib/content-pilot/publish-reconciliation.ts
- Create: __tests__/lib/content-pilot/publish-service.test.ts
- Modify: app/api/content-pilot/proposals/[id]/publish/route.ts
- Create: app/api/content-pilot/proposals/[id]/reconcile-publish/route.ts
- Modify: app/api/cron/publish-scheduled/route.ts
- Modify: app/api/cron/reindex-published/route.ts
- Modify: app/(embedded)/(content-pilot)/content-pilot/components/types.ts
- Modify: app/(embedded)/(content-pilot)/content-pilot/components/queue/ProposalRow.tsx
- Modify: app/(embedded)/(content-pilot)/content-pilot/draft/[id]/page.tsx
- Modify: __tests__/api/content-pilot-publish-failure.test.ts
- Modify: __tests__/lib/content-pilot/publish-draft.test.ts

**Interfaces:**
- Produces: publishContentProposal({ prismaClient, proposalId, actor, trigger, dueBefore? }): Promise<PublishResult>.
- PublishResult kinds: published, published_with_warnings, conflict, failed_before_external_write, reconciliation_required.
- Produces: finalizePublishedProposal(client, operationId), retryIncompletePublishFinalizations(client, limit), reconcilePublishOperation(input).

- [ ] **Step 1: Write fresh-read and manual/cron parity tests**

Assert the service claims by ID/status/ready, re-fetches by publishOperationId, and sends the re-fetched object to publishDraft. Run the same success fixture with manual and scheduled triggers and compare persisted receipt fields, baselineSeoScore, proposedState blogHandle, Opportunity state, and audit metadata.

- [ ] **Step 2: Write the post-Shopify failure matrix**

~~~ts
it.each(["opportunity", "audit", "reindex"])(
  "keeps published state when %s bookkeeping fails",
  async (failure) => {
    const result = await publishWithFailureAfterShopify(failure);
    expect(result.kind).toBe("published_with_warnings");
    expect(lastProposalUpdate()).toEqual(expect.objectContaining({ draftStatus: "published" }));
    expect(noRecoveryUpdateToReadyOrFailed()).toBe(true);
  },
);
~~~

Add receipt-write failure asserting reconciliation_required/202 semantics and no ordinary recovery call. Add finalizer retry idempotency asserting exactly one audit record.

- [ ] **Step 3: Write scheduled stale-edit regression**

The initial due query returns an old draft. The post-claim findUnique returns edited content. Assert publishDraft receives edited content only.

- [ ] **Step 4: Run Task 5 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/content-pilot/publish-service.test.ts __tests__/api/content-pilot-publish-failure.test.ts
~~~

Expected: shared service absent; scheduled path publishes its pre-lock object and lacks finalization parity.

- [ ] **Step 5: Implement publish-service phases**

Implement claim/fresh read, precomputed baseline/blog context, injected Shopify adapter call, minimal receipt update, and transactional finalizer. After the adapter resolves, catch blocks must return published_with_warnings or reconciliation_required and must never invoke pre-external recovery.

The finalizer transaction first conditionally sets publishFinalizedAt for matching operation where it is null, then resolves Opportunity and creates audit within the same transaction. Rollback makes retry safe.

- [ ] **Step 6: Implement reconciliation inspection**

Use existing Shopify read helpers. Compare proposal-type-specific expected values and return applied, not_applied, or ambiguous. Only not_applied may return a proposal to ready. Applied records the receipt/finalizer; ambiguous remains publish-error with a visible message.

- [ ] **Step 7: Migrate manual and scheduled routes**

Manual route maps typed results to status/JSON. Scheduled route selects IDs only, calls the service, retries at most fifty incomplete finalizers without a Shopify call, and reports truthful per-item outcomes. Preserve cron auth and publish-scheduled job lock.

- [ ] **Step 8: Add operator-visible warning/reconciliation UI**

Render publishWarning for published rows. Render a critical reconciliation-required banner for stale publishing/publish-error operations and a CONTENT_PUBLISH-backed Reconcile action. A successful Shopify response with warning must say Published with warning, never Publish failed.

- [ ] **Step 9: Run Task 5 verification**

~~~bash
npm test -- --run __tests__/lib/content-pilot/publish-service.test.ts __tests__/api/content-pilot-publish-failure.test.ts __tests__/lib/content-pilot/publish-draft.test.ts __tests__/components/pilot-usability-helpers.test.ts
npm run typecheck
npm run typecheck:test
~~~

Expected: pass.

- [ ] **Step 10: Run GROW and commit Task 5**

Update pilot-queue-usability and publish recovery documentation.

~~~bash
git add lib/content-pilot/publish-service.ts lib/content-pilot/publish-reconciliation.ts app/api/content-pilot/proposals app/api/cron/publish-scheduled app/api/cron/reindex-published 'app/(embedded)/(content-pilot)' __tests__/lib/content-pilot/publish-service.test.ts __tests__/api/content-pilot-publish-failure.test.ts __tests__/lib/content-pilot/publish-draft.test.ts __tests__/components/pilot-usability-helpers.test.ts .mex
git commit -m "fix: unify and reconcile Content Pilot publishing"
~~~

---

### Task 6: Secure and Preserve Filipino Regeneration

**Findings:** F01

**Files:**
- Create: __tests__/api/content-pilot-regenerate-filipino.test.ts
- Modify: app/api/content-pilot/regenerate-filipino/route.ts
- Modify: docs/OPERATIONS.md

**Interfaces:**
- Consumes: generateProposalDraft from Task 4 and publishContentProposal from Task 5.
- POST body: { proposalIds: string[]; confirmation: string; republishPublished: boolean }.
- Maximum target count: 25.
- Produces per-item status and aggregate totals; uses 200/207/4xx semantics from the design.

- [ ] **Step 1: Write request-boundary regressions**

Cover missing permission, omitted body, empty IDs, more than 25 IDs, duplicate IDs, bad confirmation, unknown IDs, pending/rejected proposals, and rate limiting. Assert no AI or Shopify call on every request-level failure.

- [ ] **Step 2: Write apply/republish regressions**

~~~ts
it("never widens an omitted selection to all proposals", async () => {
  const response = await POST(request({ proposalIds: [] }));
  expect(response.status).toBe(400);
  expect(mockPrisma.contentProposal.findMany).not.toHaveBeenCalled();
});

it("republishes only explicitly selected published targets", async () => {
  await POST(request({ proposalIds: ["p1"], confirmation: CONFIRM, republishPublished: true }));
  expect(mockPublishContentProposal).toHaveBeenCalledTimes(1);
  expect(mockPublishContentProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "p1" }));
});
~~~

Add a mixed-result case expecting 207 with counts for succeeded, stillFilipino, conflict, and failed.

- [ ] **Step 3: Run Task 6 tests and verify RED**

~~~bash
npm test -- --run __tests__/api/content-pilot-regenerate-filipino.test.ts
~~~

Expected: current endpoint accepts app auth, optional query ID, and direct publishDraft.

- [ ] **Step 4: Implement the bounded command**

Use CONTENT_PUBLISH first, Zod-validate the exact body, checkRateLimit per shop/user, re-detect server-side, validate publishable status, and process only the selected IDs. Remove the direct publishDraft import. Use preservePublishedReceipt generation for live rows and shared publishing only when republishPublished is true.

- [ ] **Step 5: Update operations documentation**

Document the scan/apply separation, bounded body, confirmation phrase, permission, and mixed-result interpretation without including credentials.

- [ ] **Step 6: Run Task 6 verification**

~~~bash
npm test -- --run __tests__/api/content-pilot-regenerate-filipino.test.ts __tests__/lib/content-pilot/generation-service.test.ts __tests__/lib/content-pilot/publish-service.test.ts
npm run typecheck
~~~

Expected: pass and source search shows no direct publishDraft call in regenerate-filipino.

- [ ] **Step 7: Run GROW and commit Task 6**

~~~bash
git add app/api/content-pilot/regenerate-filipino/route.ts __tests__/api/content-pilot-regenerate-filipino.test.ts docs/OPERATIONS.md .mex
git commit -m "fix: secure bounded Filipino content regeneration"
~~~

---

### Task 7: Make Canonical Creation and Proposal Replacement Atomic

**Findings:** F09, F16

**Files:**
- Create: lib/content-pilot/proposal-replacement.ts
- Create: __tests__/lib/content-pilot/proposal-replacement.test.ts
- Modify: lib/content-pilot/create-proposal.ts
- Modify: app/api/content-pilot/proposals/generate/route.ts
- Modify: app/api/cron/daily/route.ts
- Modify: app/api/content-pilot/proposals/refresh-all/route.ts
- Modify: app/api/seo/gaps/promote/route.ts
- Modify: app/api/seo/recommendations/decompose/route.ts
- Modify: lib/opportunities/route.ts
- Modify: __tests__/lib/content-pilot/create-proposal.test.ts
- Modify: __tests__/api/content-pilot-routes.test.ts
- Modify: __tests__/lib/opportunities/route.test.ts

**Interfaces:**
- createContentProposalOnce client requires createMany and findUnique; it no longer catches P2002.
- Produces: replacePendingContentProposals(client, inputs): { proposals; created; existing; opportunities; removed }.

- [ ] **Step 1: Write conflict-do-nothing helper tests**

~~~ts
it("returns the winner without throwing inside a transaction", async () => {
  client.contentProposal.createMany.mockResolvedValue({ count: 0 });
  client.contentProposal.findUnique.mockResolvedValue(existing);
  await expect(createContentProposalOnce(client, input)).resolves.toEqual({
    proposal: existing,
    created: false,
  });
  expect(client.contentProposal.create).not.toHaveBeenCalled();
});
~~~

Cover count one, zero then delayed read, and typed missing-winner error.

- [ ] **Step 2: Write proposal replacement rollback tests**

Inject failure at Opportunity terminal marking, delete, insert, and Opportunity upsert. Assert the transaction rejects and the root caller does not perform any related write outside it. Assert Opportunity rows are derived from actual returned proposal rows, not all fresh inputs.

- [ ] **Step 3: Run Task 7 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/content-pilot/create-proposal.test.ts __tests__/lib/content-pilot/proposal-replacement.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/lib/opportunities/route.test.ts
~~~

Expected: current helper catches P2002; replacement marks Opportunities before and after its transaction.

- [ ] **Step 4: Implement createMany skipDuplicates creation**

~~~ts
const insert = await client.contentProposal.createMany({
  data: [keyed],
  skipDuplicates: true,
});
let proposal = await client.contentProposal.findUnique({ where: { dedupeKey: keyed.dedupeKey } });
if (!proposal && insert.count === 0) {
  proposal = await client.contentProposal.findUnique({ where: { dedupeKey: keyed.dedupeKey } });
}
if (!proposal) throw new ContentProposalConcurrencyError(keyed.dedupeKey);
return { proposal, created: insert.count === 1 };
~~~

- [ ] **Step 5: Implement one replacement transaction**

Move pending selection, linked Opportunity terminal updates, pending deletion, canonical inserts, and Opportunity upserts into proposal-replacement.ts. Deduplicate inputs before the transaction, preserve recreate blockers, and upsert Opportunities only for returned rows.

- [ ] **Step 6: Migrate every transactional caller**

Manual generation and daily cron call the shared replacement service. Batch SEO/decomposition callers use exception-free create-once inside their existing transaction. Remove P2002-within-transaction catch assumptions and duplicate out-of-transaction Opportunity writes.

- [ ] **Step 7: Run Task 7 verification**

~~~bash
npm test -- --run __tests__/lib/content-pilot/create-proposal.test.ts __tests__/lib/content-pilot/proposal-replacement.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/opportunities/route.test.ts
npm run typecheck
~~~

Expected: pass.

- [ ] **Step 8: Run GROW and commit Task 7**

Update generation-dedupe with conflict-do-nothing semantics and transactional Opportunity parity.

~~~bash
git add lib/content-pilot/create-proposal.ts lib/content-pilot/proposal-replacement.ts app/api/content-pilot app/api/cron/daily app/api/seo lib/opportunities __tests__/lib/content-pilot/create-proposal.test.ts __tests__/lib/content-pilot/proposal-replacement.test.ts __tests__/api/content-pilot-routes.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/lib/opportunities/route.test.ts .mex
git commit -m "fix: make proposal replacement transaction-safe"
~~~

---

### Task 8: Preserve Partial SEO Analysis and Parse Later Valid AI Output

**Findings:** F07, F18

**Files:**
- Modify: lib/seo/ai-output.ts
- Modify: app/api/seo/analyze/route.ts
- Modify: app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts
- Modify: app/(embedded)/(seo-pillar)/seo-pillar/page.tsx
- Modify: __tests__/lib/seo/ai-output.test.ts
- Modify: __tests__/api/seo-pilot-routes.test.ts

**Interfaces:**
- parseJsonObject/parseJsonArray signatures remain unchanged.
- Analysis adds aiErrorCode?: provider_auth | provider_config | provider_rate_limit | provider_timeout | provider_unavailable | invalid_output.
- Provider failures with deterministic data return HTTP 200 and analysis.aiStatus partial.

- [ ] **Step 1: Write multi-candidate parser regressions**

~~~ts
it("skips a malformed leading object and accepts a later valid object", () => {
  const text = "{not json}\n{\"quickWins\":[],\"recommendations\":[]}";
  expect(parseJsonObject(text, schema).ok).toBe(true);
});

it("does not let an unmatched leading brace hide later valid JSON", () => {
  const text = "reasoning { unfinished\n{\"quickWins\":[],\"recommendations\":[]}";
  expect(parseJsonObject(text, schema).ok).toBe(true);
});
~~~

Retain quoted-brace, escaped-quote, fenced JSON, invalid-schema, and empty tests.

- [ ] **Step 2: Write provider failure partial-analysis tests**

For auth, configuration, connection, rate-limit, and timeout errors, assert status 200, deterministic contentGaps retained, aiStatus partial, safe aiErrorCode, snapshot upsert, and no provider body/secret exposure.

- [ ] **Step 3: Run Task 8 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/seo/ai-output.test.ts __tests__/api/seo-pilot-routes.test.ts
~~~

Expected: parser stops at the first candidate; provider exceptions return 500/504 without a snapshot.

- [ ] **Step 4: Implement candidate scanning**

Scan every opening delimiter. Track quoted/escaped state for each candidate, attempt JSON and Zod validation, and continue after malformed or schema-invalid candidates. Return success on the first valid candidate and the most specific exhausted failure otherwise.

- [ ] **Step 5: Build and persist partial analysis in catch paths**

Create the deterministic analysis object before the provider call. On classified provider errors, attach safe error metadata, upsert seo_analysis, and return it with warning metadata. Invalid provider output continues through the same partial builder. Only snapshot persistence failure returns an actual 500.

- [ ] **Step 6: Update UI feedback**

Keep content gaps visible, render the existing incomplete banner with safe reason-specific copy, and allow retry. Never replace a partial analysis with a generic failed page.

- [ ] **Step 7: Run Task 8 verification**

~~~bash
npm test -- --run __tests__/lib/seo/ai-output.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/api/seo-brief-grounding.test.ts
npm run typecheck
~~~

Expected: pass.

- [ ] **Step 8: Run GROW and commit Task 8**

~~~bash
git add lib/seo/ai-output.ts app/api/seo/analyze/route.ts 'app/(embedded)/(seo-pillar)' __tests__/lib/seo/ai-output.test.ts __tests__/api/seo-pilot-routes.test.ts .mex
git commit -m "fix: preserve SEO findings across AI failures"
~~~

---

### Task 9: Arbitrate GA4 Sources and Show Freshness

**Findings:** F08, F15

**Files:**
- Create: lib/seo/ga4-selection.ts
- Create: __tests__/lib/seo/ga4-selection.test.ts
- Modify: lib/seo/data.ts
- Modify: app/api/seo/route.ts
- Modify: app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts
- Modify: app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OverviewPanel.tsx
- Modify: app/(embedded)/(seo-pillar)/seo-pillar/page.tsx
- Modify: __tests__/lib/seo/data.test.ts
- Modify: __tests__/components/pilot-usability-helpers.test.ts

**Interfaces:**
- Produces: selectGa4Source({ normalized, raw, thresholdMs }): Ga4Selection.
- LatestGa4Data gains freshness metadata matching the approved design.

- [ ] **Step 1: Write pure arbitration tests**

Cover normalized preferred, empty normalized fallback, raw materially newer, normalized-only, raw-only, and no usable data. Fix threshold at 24 hours.

~~~ts
expect(selectGa4Source({ normalized: emptyWindow, raw: populatedRaw, thresholdMs: DAY }).source)
  .toBe("rawSnapshot");
~~~

- [ ] **Step 2: Write API/UI freshness tests**

Assert /api/seo returns both GSC and GA4 freshness. Assert Overview renders GA4 updated time and Raw fallback when selected, and No GA4 data only when source is none.

- [ ] **Step 3: Run Task 9 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/seo/ga4-selection.test.ts __tests__/lib/seo/data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/pilot-usability-helpers.test.ts
~~~

Expected: empty normalized window returns none and Overview lacks GA4 freshness.

- [ ] **Step 4: Implement GA4 arbitration and metadata**

Load normalized window/rows and raw snapshot before selecting. Use the pure helper. Return selected and alternate timestamps/ranges plus fallback reason. Do not mutate either source.

- [ ] **Step 5: Render operator freshness**

Pass ga4FetchedAt and source/freshness into OverviewPanel. Show GSC and GA4 on separate readable lines with normalized/raw/no-data labels and stale fallback explanation.

- [ ] **Step 6: Run Task 9 verification**

~~~bash
npm test -- --run __tests__/lib/seo/ga4-selection.test.ts __tests__/lib/seo/data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/pilot-usability-helpers.test.ts
npm run typecheck
~~~

Expected: pass.

- [ ] **Step 7: Run GROW and commit Task 9**

~~~bash
git add lib/seo/ga4-selection.ts lib/seo/data.ts app/api/seo/route.ts 'app/(embedded)/(seo-pillar)' __tests__/lib/seo/ga4-selection.test.ts __tests__/lib/seo/data.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/pilot-usability-helpers.test.ts .mex
git commit -m "fix: arbitrate and display GA4 freshness"
~~~

---

### Task 10: Paginate the Queue and Make Bulk Results Truthful

**Findings:** F11, F13, F14 UI parity

**Files:**
- Create: lib/content-pilot/queue-query.ts
- Create: __tests__/lib/content-pilot/queue-query.test.ts
- Create: __tests__/api/content-pilot-pagination.test.ts
- Modify: app/api/content-pilot/proposals/route.ts
- Modify: app/(embedded)/(content-pilot)/content-pilot/components/QueueTab.tsx
- Modify: app/(embedded)/(content-pilot)/content-pilot/components/queue/QueueFilters.tsx
- Modify: app/(embedded)/(content-pilot)/content-pilot/components/queue/QueueModals.tsx
- Modify: app/(embedded)/(content-pilot)/content-pilot/components/types.ts
- Modify: __tests__/components/pilot-usability-helpers.test.ts

**Interfaces:**
- Produces parseContentProposalQueueQuery(url) and contentProposalQueueWhere(query).
- GET response: { proposals, total, stageCounts, pageInfo, filters }.
- approve returns Promise<{ ok: true } | { ok: false; error: string }>.
- loadAllMatchingPages(query) returns the exact set used by Generate All and Publish All review.

- [ ] **Step 1: Write query normalization and stable-order tests**

Cover default limit 50, maximum 100, invalid cursor/filter/sort 400 behavior, server search/type/priority/stage filters, and ID tie-breaker.

- [ ] **Step 2: Write more-than-200 API regression**

Mock 201 records over three pages. Assert page one total is 201, hasNextPage true, cursor advances without duplicate/omitted IDs, and final page completes all 201.

- [ ] **Step 3: Write bulk approval chaining regression**

~~~ts
it("generates only successfully approved proposals", async () => {
  mockApprove.mockResolvedValueOnce({ ok: false, error: "conflict" });
  mockApprove.mockResolvedValueOnce({ ok: true });
  const result = await approveAndGenerate(["p1", "p2"]);
  expect(mockGenerate).toHaveBeenCalledWith("p2");
  expect(mockGenerate).not.toHaveBeenCalledWith("p1");
  expect(result).toMatchObject({ approved: 1, generated: 1, failed: 1 });
});
~~~

Also assert reopened pending/approved rows participate consistently after Task 2 state reset.

- [ ] **Step 4: Run Task 10 tests and verify RED**

~~~bash
npm test -- --run __tests__/lib/content-pilot/queue-query.test.ts __tests__/api/content-pilot-pagination.test.ts __tests__/components/pilot-usability-helpers.test.ts
~~~

Expected: current API hard-caps at 200 and approve returns void.

- [ ] **Step 5: Implement paginated API transaction**

Validate query params with Zod. In one Prisma transaction or consistent read sequence, call findMany with stable order/cursor, count with matching where, and grouped stage counts. Return nextCursor only when another row exists by overfetching limit plus one.

- [ ] **Step 6: Implement paginated QueueTab loading**

Initial filter changes replace rows; Load more appends deduped rows. Preserve current rows on later-page failure and show retry. Use server totals/counts. Clear selection on filter reset.

- [ ] **Step 7: Preserve complete all-actions**

Before Generate All or Publish All, fetch every matching page. Publish All modal shows the exact complete candidates and retains its reviewed checkbox. Never publish an ID that was not rendered in the review modal.

- [ ] **Step 8: Return typed approval results and truthful summaries**

Change approve to return success/failure. Bulk workers stop per-item chains after failure and aggregate approved/generated/conflict/failed totals. Preserve the first specific error and show a batch summary.

- [ ] **Step 9: Run Task 10 verification**

~~~bash
npm test -- --run __tests__/lib/content-pilot/queue-query.test.ts __tests__/api/content-pilot-pagination.test.ts __tests__/components/pilot-usability-helpers.test.ts __tests__/api/content-pilot-routes.test.ts
npm run typecheck
npm run typecheck:test
~~~

Expected: pass.

- [ ] **Step 10: Run GROW and commit Task 10**

Update pilot-queue-usability with pagination, truthful totals, and complete-review bulk behavior.

~~~bash
git add lib/content-pilot/queue-query.ts app/api/content-pilot/proposals/route.ts 'app/(embedded)/(content-pilot)' __tests__/lib/content-pilot/queue-query.test.ts __tests__/api/content-pilot-pagination.test.ts __tests__/components/pilot-usability-helpers.test.ts __tests__/api/content-pilot-routes.test.ts .mex
git commit -m "fix: paginate Content Pilot and chain bulk results"
~~~

---

### Task 11: Prove Migrations and Concurrency on PostgreSQL

**Findings:** F06, F09, F10, F16, F17 integration proof

**Files:**
- Create: __tests__/integration/postgres/content-proposal-races.test.ts
- Create: __tests__/integration/postgres/content-proposal-migrations.test.ts
- Create: __tests__/integration/postgres/proposal-transactions.test.ts
- Modify: __tests__/prisma/content-proposal-dedupe-migration.test.ts
- Modify: .github/workflows/ci.yml
- Modify: app/api/content-pilot/proposals/[id]/generate-draft/route.ts

**Interfaces:**
- Uses DATABASE_URL_TEST only after assertNonProductionDatabaseUrl passes.
- Runs serially against disposable PostgreSQL 16 schema/database.

- [ ] **Step 1: Write the migration upgrade fixture**

Apply migrations only through the state before proposal citations/dedupe/lifecycle changes, insert:

- pending, approved, rejected, and published proposals;
- canonical collisions;
- draft history;
- Opportunity routing;
- non-null review/schedule/publish values.

Apply remaining migrations and assert citations/lifecycle columns exist, canonical/history keys are deterministic, child rows remain linked, and no approval/review/draft/publish value changed.

- [ ] **Step 2: Write real canonical insertion races**

Run ten concurrent createContentProposalOnce calls on the root client and in separate interactive transactions. Assert one canonical row, one created result, nine existing results, no aborted follow-up reads, and no 500-equivalent exception.

- [ ] **Step 3: Write real state interleavings**

Use controlled promises/transactions to prove:

- rejection invalidates generation completion;
- two publish claims yield one winner;
- draft edit before publish claim is present in the post-claim read;
- audit/Opportunity failure rolls back review transitions;
- proposal replacement rollback preserves old proposals and Opportunities.

- [ ] **Step 4: Run Task 11 tests and verify RED**

Run against a disposable local/CI PostgreSQL URL:

~~~bash
DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres
~~~

Expected: new integration files initially fail until harness setup and prior task contracts are complete. If PostgreSQL is unavailable locally, record that fact and run through the CI service before task completion; do not substitute mocks.

- [ ] **Step 5: Implement fixture setup/cleanup and resolve failures**

Use beforeAll to validate the URL, create/reset only the disposable test schema, apply migrations non-interactively, and afterAll disconnect/clean. Never accept DATABASE_URL or DATABASE_URL_PROD as an implicit fallback.

Fix only plan-scoped implementation defects exposed by real PostgreSQL. Repeat red-green evidence for each correction.

- [ ] **Step 6: Pin CI PostgreSQL execution**

Run test:postgres after Prisma generation/typechecks and before the full mocked suite/build. Upload no database dump containing secrets.

- [ ] **Step 7: Remove stale migration assumptions**

Replace the generate-draft comment claiming citations is not live with deployment-neutral best-effort wording. Keep citation collection failure isolated, but do not claim missing-column reads are safe.

- [ ] **Step 8: Run Task 11 verification**

~~~bash
npm run db:generate
npm run verify:prisma-client
DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres
npm test -- --run __tests__/prisma __tests__/lib/content-pilot __tests__/api/content-pilot-publish-failure.test.ts
npm run typecheck
~~~

Expected: all commands pass against real PostgreSQL and mocked suites.

- [ ] **Step 9: Run GROW and commit Task 11**

Record migration names, PostgreSQL version, test safety guard, and concurrency results.

~~~bash
git add __tests__/integration/postgres __tests__/prisma .github/workflows/ci.yml app/api/content-pilot/proposals/[id]/generate-draft/route.ts .mex
git commit -m "test: prove Content Pilot migrations and races on PostgreSQL"
~~~

---

### Task 12: Complete Traceability, Final Gates, Whole-Branch Review, and Merge

**Findings:** Final proof for F01–F18

**Files:**
- Modify: docs/superpowers/plans/2026-07-10-seo-content-pilot-complete-remediation.md to check executed steps
- Modify: docs/superpowers/specs/2026-07-10-seo-content-pilot-complete-remediation-design.md only if approved clarifications are required
- Modify: .mex/ROUTER.md
- Modify: .mex/context/architecture.md if shared service facts changed
- Modify: .mex/context/data-pipeline.md if cron/finalization facts changed
- Modify: .mex/context/conventions.md if verification requirements changed
- Modify: .mex/patterns/generation-dedupe.md
- Modify: .mex/patterns/pilot-queue-usability.md
- Modify: .mex/patterns/seo-pilot-proposal-actions.md
- Modify: .mex/events/decisions.jsonl through mex log when available

**Interfaces:**
- Produces a completed F01–F18 evidence matrix with commit, test, and review references.
- Produces one merge-ready branch; deployment remains separate.

- [ ] **Step 1: Build the final traceability ledger**

For every F01–F18 row, record:

- implementation commit;
- red test command/result;
- green focused command/result;
- specification review status;
- code-quality review status;
- final-gate command covering it.

Any blank cell blocks completion.

- [ ] **Step 2: Run focused cross-pilot suites**

~~~bash
npm test -- --run \
  __tests__/api/seo-pilot-routes.test.ts \
  __tests__/api/content-pilot \
  __tests__/api/content-pilot-routes.test.ts \
  __tests__/lib/seo \
  __tests__/lib/content-pilot \
  __tests__/lib/opportunities \
  __tests__/components/pilot-usability-helpers.test.ts \
  __tests__/components/use-seo-data.test.ts \
  __tests__/prisma
~~~

Expected: all selected files pass with zero failures.

- [ ] **Step 3: Run PostgreSQL final gate**

~~~bash
DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres
~~~

Expected: all migration, race, and transaction integration tests pass.

- [ ] **Step 4: Run repository gates separately and record exit status**

~~~bash
npm run db:generate
npm run verify:prisma-client
npm run typecheck
npm run typecheck:test
npm run lint
npm test
DATABASE_URL='postgresql://readonly:readonly@127.0.0.1:5432/readonly?connection_limit=1' npx prisma validate
DATABASE_URL='postgresql://readonly:readonly@127.0.0.1:5432/readonly?connection_limit=1' npm run build
npm audit --audit-level=moderate
git diff --check main...HEAD
~~~

Expected: every command exits 0. Do not infer one gate from another.

- [ ] **Step 5: Run security and invariant searches**

~~~bash
! git grep -nE 'BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY|sk-or-v1-|ghp_[A-Za-z0-9_]{20,}|Bearer [A-Za-z0-9._-]{40,}' -- ':!package-lock.json' ':!.github/workflows/ci.yml'
! rg -n 'new PrismaClient' app lib jobs
! rg -n 'NEXT_PUBLIC_AUTOPILOT_API_KEY' app components hooks lib
rg -n 'pause_ad' lib/guardrails.ts
~~~

Expected: no secret/direct-client/public-key hits; pause_ad remains outside CONVERSION_SENSITIVE_ACTIONS.

- [ ] **Step 6: Complete the project Verify Checklist explicitly**

Record PASS/FAIL for:

1. Every modified embedded mutation authenticates/authorizes first.
2. Cron routes authenticate synchronously and retain matching job-lock release in finally.
3. All DB access uses the singleton or passed transaction client.
4. AI output is Zod-validated before persistence.
5. No server secret is public.
6. Job result and lock contracts remain valid.
7. No prompt was moved into an inappropriate TypeScript surface.
8. pause_ad guardrail behavior is untouched.
9. No feature was disabled or removed.
10. No production/live action was executed.

- [ ] **Step 7: Run GROW**

Ground the exact behavior and commands. Update ROUTER and only relevant context/pattern files, bump last_updated, and run:

~~~bash
mex log --type decision "SEO and Content Pilot remediation now uses permission-complete mutations, durable generation ownership, shared publish receipts/finalization/reconciliation, PostgreSQL-safe proposal identity, explicit AI/GA4 partial states, and complete paginated operator queues."
~~~

If mex is unavailable, record that fact without fabricating an event entry.

- [ ] **Step 8: Commit final documentation**

~~~bash
git add docs/superpowers/plans/2026-07-10-seo-content-pilot-complete-remediation.md docs/superpowers/specs/2026-07-10-seo-content-pilot-complete-remediation-design.md .mex
git commit -m "docs: finalize complete pilot remediation"
~~~

- [ ] **Step 9: Dispatch whole-branch specification and code-quality reviews**

Review main...HEAD against the approved design and this plan. Resolve every finding with another red-green cycle and focused commit. Repeat both reviews until each explicitly approves with no unresolved item.

- [ ] **Step 10: Re-run all final gates after the last review fix**

Repeat Steps 2–6 from the final commit. Earlier output is not sufficient.

- [ ] **Step 11: Verify final repository state**

~~~bash
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
~~~

Expected: clean worktree; only remediation-scoped files; sequential task commits; no environment, credential, deployment, or unrelated changes.

- [ ] **Step 12: Open the final PR and require green CI**

Push only the remediation branch, open a PR to main, and wait for the verify workflow. Do not deploy. If CI fails, diagnose on the remediation branch, fix with red-green evidence, rerun all affected gates, and repeat review as required.

- [ ] **Step 13: Merge once and report**

After all local gates, PostgreSQL gates, reviews, traceability, and PR CI pass, merge the complete PR into main once. Report merge commit, task commits, exact command results, CI URL/status, remaining risks (expected: none from F01–F18), and final repository status. Do not run the production deploy script.

---

## Plan Self-Review Checklist

- [x] Spec coverage: Tasks 1–12 cover every F01–F18 row.
- [x] No feature-disable, rebuild, or deferral step exists.
- [x] Every behavioral task begins with a failing regression and ends with focused green verification and a commit.
- [x] Permission names, lifecycle field names, result kinds, and service signatures remain consistent across tasks.
- [x] Manual, scheduled, and Filipino maintenance publishing all consume the shared publish service.
- [x] Review transitions and proposal/Opportunity replacement use transactions.
- [x] P2002-in-transaction recovery is removed in favor of createMany skipDuplicates.
- [x] Real PostgreSQL—not mocks or SQL string checks—proves migrations and races.
- [x] No task authorizes live Shopify, Meta, production database, SSH, deployment, or publishing verification.
- [x] Final merge is all-or-nothing and deployment remains separate.
