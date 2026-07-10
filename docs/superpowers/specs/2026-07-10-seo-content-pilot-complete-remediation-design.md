# SEO Pilot and Content Pilot Complete Remediation Design

**Date:** 2026-07-10
**Status:** Proposed — awaiting operator approval
**Delivery:** One isolated remediation branch, sequential reviewed commits, one final merge after every finding and gate passes

## Goal

Resolve every confirmed defect and suspected risk from the comprehensive SEO Pilot and Content Pilot functional review without rebuilding, disabling, deleting, or deferring any affected feature.

Priority controls implementation order only. It does not reduce scope. Completion requires every traceability row in this design to be implemented, tested, reviewed, documented, and verified.

## Revalidated Baseline

The design is based on the current checkout at main commit df4668b and an isolated worktree at:

- path: /home/sean/Agriko/auto-pilot-seo-content-complete-remediation
- branch: seo-content-complete-remediation

Clean-worktree baseline results:

- npm install: 615 packages installed, 0 vulnerabilities
- npm test: 145 files passed, 906 tests passed
- npm run typecheck: passed
- npm run typecheck:test: passed
- Prisma validate with a non-production localhost placeholder URL: passed

This baseline corrects one audit nuance: the earlier Prisma type failure was caused by a stale generated client in the original working directory. A clean install generates a compatible client. The remediation still makes generation an explicit CI and local gate so correctness never depends on implicit package-install behavior.

All other findings below were reverified against current source. No live Shopify, Meta, production database, migration, deployment, publishing, or SSH operation was used.

## Non-Negotiable Invariants

- Every feature remains available after remediation, including Filipino-content regeneration, bulk operations, scheduling, and publishing.
- Content changes require operator review. Shopify writes require CONTENT_PUBLISH.
- No rejected, pending, stale, or concurrently changed proposal may be published.
- No post-Shopify bookkeeping failure may be represented as an ordinary pre-publish failure.
- Manual and scheduled publishing must use the same domain operation and finalization rules.
- All database access continues through the project Prisma singleton or a transaction client passed from it.
- Cron authentication and route-level job locks remain intact.
- Existing recommendation guardrails and the pause_ad invariant are untouched.
- No production mutation is part of implementation verification.
- All schema changes are additive and backward-compatible. Existing migration files are not rewritten after publication; corrections use forward migrations.
- No finding may be closed solely by documentation or a mocked unit test when a PostgreSQL or concurrency behavior is in question.

## Approaches Considered

### Approach A: Patch each route independently

This would add missing permission calls, re-fetch scheduled proposals, and adjust individual catch blocks in place.

Advantages:

- Smallest immediate diff.
- Fastest way to make isolated route tests green.

Rejected because:

- Manual and scheduled publishing would continue to drift.
- State transitions and audit/Opportunity writes would remain duplicated.
- Concurrency behavior would remain difficult to reason about and test.
- It would treat shared root causes as unrelated defects and invite recurrence.

### Approach B: Focused shared-domain remediation — selected

Keep the existing Next.js pages, API endpoints, Prisma models, Polaris UI, AI client, and operator workflow. Add small shared services for authorization policy, proposal transitions, generation ownership, publish orchestration, finalization, and paginated queue reads.

Advantages:

- Resolves the shared causes rather than only visible symptoms.
- Preserves the product and existing tests.
- Gives manual, scheduled, and maintenance paths one set of safety rules.
- Supports red-green task commits and straightforward rollback.
- Avoids introducing a new framework or infrastructure service.

Trade-off:

- Requires a small additive migration for durable operation tokens and publish finalization metadata.

### Approach C: Replace the workflow with a new job/workflow engine

This would move generation and publishing into a new durable queue and redesign the proposal state model.

Rejected because:

- It is effectively a rebuild of working functionality.
- It broadens operational infrastructure beyond the requested scope.
- Migration and rollout risk would be much higher than the focused domain-service approach.

## Finding-to-Design Traceability

| ID | Revalidated finding or risk | Resolution in this design | Required proof |
|---|---|---|---|
| F01 | Authenticated users can run unbounded regenerate-filipino and republish live articles | Bounded explicit request contract, CONTENT_PUBLISH, confirmation, approved-state validation, generation ownership, publish orchestration, per-item results | RBAC, empty-selection, limit, confirmation, state, lock, mixed-result route tests |
| F02 | Content mutation RBAC is inconsistent and an authenticated viewer can edit scheduled content | Central mutation permission matrix; CONTENT_REVIEW for all proposal/review mutations, CONTENT_PUBLISH for schedule/live operations | Table-driven 401/403 tests proving no DB, AI, or Shopify call occurs |
| F03 | Scheduled publishing uses a stale pre-lock proposal | Shared claim function re-fetches by operation token after lock; only the fresh row reaches publishDraft | Interleaved edit-between-read-and-lock regression |
| F04 | Scheduled publishing omits SEO baseline, blog handle, and Opportunity resolution | Manual and cron paths call one publish receipt/finalization service | Manual/scheduled parity tests over all persisted outcome fields |
| F05 | Shopify success can be reported and stored as ordinary failure when bookkeeping fails | External-success boundary, durable receipt first, idempotent finalizer, published-with-warning result, explicit unknown-receipt recovery | Audit/Opportunity/reindex/receipt failure matrix |
| F06 | Rejection can be overwritten by late draft generation | Durable generation token and conditional completion/failure predicates; rejection clears ownership | Real interleaving test and route-level mocked regression |
| F07 | Provider exceptions discard deterministic SEO findings | Build partial analysis before AI, persist and return it on provider auth, connection, and timeout failures | Provider failure tests asserting persisted partial gaps and safe status metadata |
| F08 | Empty normalized GA4 windows hide valid raw data | GA4 freshness arbitration matching GSC principles | Normalized, empty-normalized, raw-newer, raw-only, and no-data tests |
| F09 | Proposal replacement and Opportunity transitions straddle transaction boundaries | One transactional replacement service using actual created rows | Rollback tests for terminal marking, deletion, creation, and Opportunity upsert failures |
| F10 | Review/edit mutations can return 500 after committing state | Transactional proposal transition services with mandatory audit/history/Opportunity effects | Failure-injection tests proving full rollback |
| F11 | Queue silently truncates at 200 and reports a false total | Server-side cursor pagination, count, stage counts, stable ordering, next-cursor metadata | More-than-200 integration and UI pagination tests |
| F12 | Prisma generation can be stale before typecheck in a reused checkout | Explicit db:generate CI step, generated-client freshness check, app and test typechecks before tests/build | Clean and deliberately stale-client command tests |
| F13 | Bulk approve generates even after approval failure | Approve returns a typed result; bulk worker generates only successful IDs and reports per-item totals | Mixed 200/409/500 component-helper tests |
| F14 | Reopen retains rejected draft state and disagrees with bulk controls | Atomic reopen resets the complete active-draft tuple while retaining draft history | Reject→reopen→approve row/bulk parity tests |
| F15 | GA4 timestamp and source are not visible | API freshness contract and Overview rendering for both GSC and GA4 | UI helper/component assertions for normalized, raw, stale, and none |
| F16 | P2002 recovery inside an interactive transaction can fail after PostgreSQL aborts the transaction | Replace exception-driven insert with createMany skipDuplicates plus findUnique | Real concurrent PostgreSQL test inside and outside interactive transactions |
| F17 | Migration/client ordering can break reads before best-effort citation handling | Forward additive migration, build→migrate→swap contract, real upgrade fixtures for citations/dedupe/lifecycle fields | PostgreSQL migration-from-prior-state suite and deploy-order policy test |
| F18 | Structured AI parser stops at the first malformed candidate | Scan all balanced candidates and validate until one succeeds | Malformed-prefix, unmatched-prefix, fenced, quoted-brace, and later-valid tests |

No traceability row is optional or deferred.

## Authorization Model

Authorization remains route-boundary enforcement, but it becomes consistent by capability.

### Read capability

General authenticated embedded users may read:

- SEO and Content Pilot dashboards;
- proposal list and detail data;
- draft history;
- Filipino detection scan results.

These handlers keep requireAppAuth as their first statement.

### CONTENT_REVIEW capability

The following mutations require requirePermission with CONTENT_REVIEW as the first handler statement:

- approve and reject;
- reopen and clone;
- generate or regenerate an ordinary draft;
- edit or restore draft content;
- create manual proposals;
- generate or refresh proposal batches;
- SEO promote, gap promote, and recommendation decomposition when they create ContentProposal rows.

These operations change the operator review queue or the content that may later be published. General authentication is insufficient.

### CONTENT_PUBLISH capability

The following require CONTENT_PUBLISH as the first handler statement:

- schedule, reschedule, or clear a schedule;
- publish now;
- reconcile an uncertain publish result;
- apply selected Filipino regeneration when it may republish live content.

The Filipino apply endpoint requires CONTENT_PUBLISH for the whole request even when a selected proposal is not yet live. A single endpoint must not have weaker authorization based on which target happens to be selected.

### Cron capability

Scheduled publishing continues to require synchronous cron authentication followed immediately by the publish-scheduled job lock. Per-proposal operation claims remain a second boundary.

### Authorization testing

A table-driven route suite will call every mutation with unauthenticated, authenticated-but-forbidden, and permitted actors. Forbidden requests must complete before database, AI, Shopify, audit, or job side effects.

## Proposal and Draft State Model

The existing status and draftStatus columns remain the public state model. The remediation adds durable operation ownership rather than replacing the lifecycle.

### Proposal status

- pending: awaiting review;
- approved or override_approved: may generate, edit, schedule, and publish;
- rejected: terminal and non-publishable until explicit reopen.

### Draft status

- null: no active draft;
- generating: one owned generation operation is active;
- ready: reviewed proposal has publishable draft content;
- publishing: one owned Shopify operation is active;
- published: Shopify success has a durable receipt;
- failed: generation or validation failed before publishing;
- publish-error: publish outcome requires inspection or reconciliation;
- rejected: proposal rejection cleared the active workflow.

### Additive lifecycle fields

ContentProposal gains nullable fields:

| Field | Purpose |
|---|---|
| draftGenerationToken | Identifies the only request allowed to complete or fail the current generation |
| draftGenerationStartedAt | Supports truthful stale-generation detection without overloading completion time |
| publishOperationId | Identifies the current Shopify attempt and makes finalization retry-safe |
| publishStartedAt | Supports unknown-outcome detection and operator feedback |
| publishFinalizedAt | Proves audit and Opportunity finalization completed for the operation |
| publishWarning | Stores post-publish warning text without changing draftStatus away from published |

publishOperationId is unique when non-null. Other new fields are nullable and indexed only where query behavior requires it.

### State predicates

Pure helpers in lib/content-pilot/proposal-state.ts define and test every allowed transition. Routes do not duplicate status arrays or infer authorization from draftStatus alone.

- Approve: pending → approved.
- Reject: any non-rejected state before publishing begins → rejected/rejected; clear schedule, active generation token, and active publish token.
- Reopen: rejected → pending; clear active draftContent, draftStatus, draftError, draft timestamps, citations, schedule, and operation tokens; retain immutable draft history.
- Generate: approved or override_approved, not publishing.
- Edit: approved or override_approved plus ready.
- Schedule: approved or override_approved plus ready.
- Publish: approved or override_approved plus ready.
- Complete generation: only the matching generation token while status remains publishable and draftStatus remains generating.
- Complete publish: only the matching publish operation.

Rejection during generation invalidates the token. A late AI success or failure receives a conflict/discarded outcome and cannot change the rejected row.

No stale publishing operation is automatically reset to ready solely by elapsed time. Unknown Shopify outcomes require safe reconciliation because retrying new-content or internal-link operations can duplicate live changes.

## Shared Generation Service

Route-owned generation orchestration moves into a focused lib/content-pilot/generation-service.ts boundary.

The service:

1. validates the proposal transition;
2. generates a cryptographically random operation token;
3. claims the row conditionally and stores the token/start time;
4. fetches canonical article context;
5. calls the existing generateDraft implementation;
6. validates the returned draft;
7. transactionally commits draftContent, ready state, completion time, cleared error, and draft-history entry only when the token still matches;
8. persists citations as a separately reported best-effort enhancement after the core transaction;
9. conditionally records failure only when the same token remains active.

The process-local inFlight set may remain as a fast duplicate-call optimization, but correctness depends on the database token. Multi-process and restarted instances are therefore safe.

Published Filipino regeneration uses the same ownership token while preserving the existing published receipt until the new draft validates. It does not erase evidence of currently live content while the AI call is running. After a successful draft commit, optional republishing enters the shared publish service.

## Shared Publish Orchestrator

Manual publish, scheduled publish, and maintenance republish call one lib/content-pilot/publish-service.ts operation.

### Phase 1: Claim and fresh read

claimProposalForPublish performs a conditional update over:

- proposal ID;
- approved or override_approved status;
- ready draftStatus;
- due schedule when the caller is scheduled publishing.

It writes draftStatus publishing, publishOperationId, publishStartedAt, clears old publish warnings, and then re-fetches by ID plus operation ID. The re-fetched row—not a pre-lock object—is the only object passed to publishDraft.

### Phase 2: Prepare local outcome context

Before the external write, the service resolves:

- canonical article handle;
- baseline SEO score;
- blog handle;
- proposedState merge;
- audit action and trigger metadata.

This ensures scheduled and manual paths have identical outcome information.

### Phase 3: Shopify write

The existing publishDraft remains the Shopify adapter. It does not own proposal state or audit behavior.

Errors before Shopify success use the existing idempotency-aware recovery classification:

- retryable idempotent operations may return to ready;
- missing targets become failed;
- ambiguous non-idempotent operations become publish-error.

### Phase 4: Durable publish receipt

Immediately after Shopify success, a minimal conditional database update records:

- draftStatus published;
- publishedAt;
- Shopify article ID and handle;
- resolved article and blog handles;
- baseline SEO score;
- cleared schedule;
- the matching publishOperationId.

Once Shopify reports success, no catch block may reset the proposal to ready, failed, or ordinary publish-error.

If this receipt write fails, the response is still typed as external_success_receipt_unknown, never as an ordinary publish failure. The row remains publishing and the UI shows a critical reconciliation-required state after reload. Automated retries are forbidden until reconciliation determines whether Shopify applied the change.

### Phase 5: Idempotent finalization

finalizePublishedProposal runs a transaction that conditionally claims publishFinalizedAt for the matching operation, resolves the routed Opportunity, and writes the audit record. A transaction rollback leaves publishFinalizedAt null, making the finalizer safely retryable without duplicate audit entries.

Finalization failure leaves draftStatus published. The service stores publishWarning when possible and returns published_with_warnings. Reindex failure is also a warning and never changes publish success.

Incomplete finalization has two retry triggers, neither of which calls Shopify. The scheduled-publish job performs a bounded pass over published rows whose publishFinalizedAt is null before processing new due work, and the queue exposes a Retry bookkeeping action for the same state. Both call only the idempotent finalizer. A successful retry clears publishWarning and sets publishFinalizedAt; a repeated failure keeps the published state and refreshes the warning.

### Reconciliation

A CONTENT_PUBLISH-protected reconciliation action handles stale publishing or external_success_receipt_unknown operations. It uses proposal type-specific Shopify inspection:

- new-content: article ID/handle/title evidence;
- internal-link: expected anchor/link presence in the source article;
- SEO metadata: expected metafield values;
- body refresh: expected body fingerprint.

Outcomes are:

- applied: record receipt and run finalization;
- not applied: return to ready only when inspection proves no live mutation occurred;
- ambiguous: remain publish-error with explicit manual-review feedback.

This preserves functionality without unsafe blind retries.

### Scheduled publishing

The cron selects only IDs and then calls the shared orchestrator for each. It does not retain full proposal objects across the claim boundary. Results distinguish published, published_with_warnings, conflict, failed_before_external_write, and reconciliation_required. Reindex runs once after the batch and failures are included in the returned summary.

## Secure Filipino Regeneration Contract

The scan GET remains read-only. The apply POST is redesigned as an explicit bounded command.

Request body:

- proposalIds: one to twenty-five unique IDs;
- confirmation: exact server-defined confirmation phrase;
- republishPublished: explicit boolean;

Rules:

- Missing or empty IDs are rejected; omission never means process all.
- More than twenty-five IDs are rejected.
- Unknown or duplicate IDs are reported without widening the target set.
- Server-side detection is repeated; client detection is never trusted.
- Every target must be approved or override_approved.
- Each target must be in a supported non-concurrent draft state.
- The request is rate-limited per authenticated shop/user.
- Each target uses the shared generation owner.
- Previously published targets are republished only when republishPublished is true and through the shared publish orchestrator.
- The route never calls publishDraft directly.

Response behavior:

- 200 when every selected target completes as requested;
- 207 for mixed success, skipped, still-Filipino, conflict, or failure results;
- 4xx for request-level authorization, confirmation, selection, or validation errors;
- 5xx only when the request cannot produce trustworthy per-item results.

The response contains totals by outcome and one safe result per requested ID. It never returns ok true while hiding failed items.

## Transactional Review and Queue Mutations

Database-only mutations use focused transaction helpers in lib/content-pilot/proposal-transitions.ts.

### Mandatory transaction contents

- approve: conditional proposal update plus audit;
- reject: conditional proposal update, Opportunity dismissal, and audit;
- reopen: complete state reset, Opportunity routing, and audit;
- draft edit/restore: conditional draft update, draft history, and audit;
- schedule/clear: conditional schedule update and audit;
- proposal replacement: terminal Opportunity updates, pending deletion, canonical proposal insertion, and Opportunity upserts for actual inserted rows.

If any mandatory write fails, the transaction rolls back and the route returns an error without a committed primary state change.

Nonessential notification or reindex work remains outside transactions and returns an explicit warning rather than changing the committed result.

### Proposal replacement

Manual generation and daily cron call one replacement service. It receives already-generated candidate inputs, applies blocking history, and within one transaction:

1. marks linked Opportunities for deleted transient proposals terminal;
2. deletes only replaceable pending proposals;
3. inserts canonical new proposals atomically;
4. creates or updates Opportunities only for rows that actually exist after conflict handling.

Manual and cron callers receive the same counts and semantics.

## PostgreSQL-Safe Canonical Proposal Creation

createContentProposalOnce stops using create followed by P2002 recovery on the same transaction client.

The replacement algorithm is:

1. compute the canonical dedupe key;
2. call contentProposal.createMany with one row and skipDuplicates true;
3. read the row using findUnique by dedupeKey;
4. report created when createMany count is one, otherwise existing;
5. if no row is found after a zero-count insert, retry the read once and then return a typed concurrency error.

PostgreSQL implements the insert as conflict-do-nothing, so the transaction is not aborted and the follow-up read remains valid. This works both on the root Prisma client and inside interactive transactions.

The same exception-free conflict pattern is used where practical for null-safe MarketKeyword insertion. Clone continues using its intentional unique random default and remains a distinct operator action.

## SEO Analysis Failure Semantics

Programmatic analysis is constructed before calling the AI provider. A shared builder produces a complete deterministic partial result containing:

- summary derived from current counts;
- empty AI quick wins and recommendations;
- all programmatic content gaps;
- evidence and corpus-limit metadata;
- aiStatus partial;
- safe aiErrorCode and aiError message.

Provider success with valid structured output upgrades that object to aiStatus complete.

Provider authentication, configuration, connection, rate-limit, and timeout failures persist and return the deterministic partial analysis with HTTP 200 because usable findings are present. The response includes warning metadata, so the UI cannot present it as a complete AI result. Database persistence failure remains an actual request failure.

Recommendation decomposition has no equivalent deterministic task set. It retains typed 502, 503, and 504 responses and never persists invalid model output.

## Structured AI Parsing

The parser scans every balanced object or array candidate outside quoted strings instead of stopping after the first opening delimiter.

For each candidate it:

1. attempts JSON parsing;
2. applies the supplied Zod schema;
3. returns the first schema-valid candidate;
4. continues after malformed or schema-invalid candidates;
5. returns the most specific failure reason only after exhausting all candidates.

Unmatched leading braces do not prevent scanning later possible starts. Fenced JSON and quoted braces remain supported. The parser never executes or repairs arbitrary model text.

## GA4 Source Arbitration and Freshness

LatestGa4Data gains freshness metadata parallel to GSC:

- selected source and capture time;
- normalized window capture and date range;
- raw snapshot capture and date range;
- fallback reason.

Selection rules:

1. use normalized rows when they are non-empty and raw data is not materially newer;
2. use raw snapshot rows when normalized rows are empty;
3. use raw snapshot rows when raw capture is more than twenty-four hours newer;
4. use normalized rows when raw data is absent;
5. return none only when neither source contains usable rows.

The SEO API returns GSC and GA4 freshness explicitly. Overview renders both timestamps and sources, including normalized, raw fallback, stale, and no-data copy. Failed refreshes retain the last valid client payload under the existing cache rules.

## Queue Pagination, Counts, and Bulk Behavior

The proposal list becomes a server-driven paginated contract.

Request fields:

- cursor;
- limit with default fifty and maximum one hundred;
- stage/status;
- search;
- proposal type;
- priority;
- sort key and direction.

Response fields:

- proposals;
- total from a matching count query;
- stageCounts from the same visibility rules;
- pageInfo with nextCursor, hasNextPage, and returned count;
- filters and ordering echoed in normalized form.

Ordering is deterministic with ID as the final tie-breaker. Cursor behavior is tested with equal priority and timestamps.

QueueTab replaces the one-shot 200-row assumption with:

- initial-page loading skeleton;
- Load more pagination with retryable page errors;
- preservation of already loaded rows when a later page fails;
- server-provided totals and stage counts;
- reset to page one when filters or sort change;
- selection scoped to explicitly loaded and visible rows.

Actions that mean all, such as Generate All Drafts or opening the Publish All review modal, must fetch every matching page before acting. Publish All continues to require the operator to review the exact complete candidate set; it never publishes unseen rows.

approve returns a typed success result. Bulk Approve & Generate calls generation only for successful approvals and reports approved, generated, conflict, and failed totals without replacing the first useful error.

Reopen clears the complete active draft tuple. Counts, row actions, checkboxes, Generate All, and bulk selection therefore use the same state rather than special-casing stale rejected draftStatus values.

## Prisma Generation and CI Determinism

The clean worktree proves the source passes when Prisma Client is current. The workflow is made explicit:

1. npm ci;
2. npm run db:generate;
3. npm run typecheck;
4. npm run typecheck:test;
5. lint, tests, migration integration, and build.

A small check compares the schema/package hash with the generated-client stamp before typecheck. Reused local workspaces fail with an actionable instruction instead of opaque TypeScript delegate errors. The build wrapper retains its existing generation safety, but it is no longer the first explicit generation point in CI.

## Migration and Backward-Compatibility Strategy

### Existing migrations

The citations and canonical dedupe migrations are treated as immutable history. Tests validate them against PostgreSQL rather than only scanning SQL text.

The current stale comment claiming the citations migration is not live is removed or replaced with deployment-neutral wording. Runtime code must not assume a missing selected column can be caught only around a later update.

### New migration

One forward additive migration introduces lifecycle ownership/finalization fields. All columns are nullable, and the old application ignores them. No approval, review, draft content, schedule, or published value is rewritten.

### Deploy compatibility

The required order remains:

1. install and build the new artifact;
2. apply additive migrations while the old application is still active;
3. swap the build;
4. restart and health-check;
5. retain rollback artifacts until health passes.

Old code must tolerate the expanded schema. New code must not start before migration success. A policy test pins this order.

### Non-production PostgreSQL validation

CI gains a PostgreSQL 16 service used only for integration tests. The suite:

- applies the full migration chain from an empty database;
- creates a database at the state immediately before citations/dedupe/lifecycle migrations, inserts representative rows and collisions, then applies remaining migrations;
- verifies citations, dedupe keys, history preservation, child relationships, approval fields, and lifecycle defaults;
- runs concurrent canonical proposal insertion inside and outside interactive transactions;
- runs generation/rejection and publish-claim interleavings;
- drops the test database after completion.

No production connection string is accepted by the integration harness. It rejects non-local hosts unless an explicit CI-only allow flag is present.

## Error and Operator-Feedback Contract

| Situation | API result | Persisted state | Operator feedback |
|---|---|---|---|
| Permission denied | 401 or 403 | unchanged | Forbidden action with required capability |
| Generation provider/validation failure | typed 4xx/5xx | failed only if generation token still matches | Safe actionable draft error |
| Generation invalidated by reject | 409 discarded | rejected remains | Proposal changed while generation ran |
| Publish fails before external success | typed failure | ready, failed, or publish-error by recovery policy | Retry or inspection guidance |
| Shopify succeeds, receipt succeeds, finalizer fails | 200 published_with_warnings | published plus publishWarning | Published; bounded cron retry and Retry bookkeeping action never call Shopify |
| Shopify succeeds, receipt cannot be stored | 202 external_success_receipt_unknown | publishing/unknown | Critical reconcile-before-retry warning |
| Reindex fails | 200 published_with_warnings | published | Local index may be stale |
| Batch has mixed outcomes | 207 | per-item truthful state | Totals and one result per selected ID |
| SEO AI fails but deterministic gaps exist | 200 partial | partial snapshot persisted | Programmatic findings available; AI narrative failed |
| Later queue page fails | page request error | no server mutation | Existing rows retained; retry page |

The client never converts a successful external write into a generic Publish failed message.

## Test Architecture

### Pure unit tests

- permission-to-route policy declarations;
- complete proposal transition matrix;
- generation and publish result classification;
- GA4 source arbitration;
- AI candidate scanning;
- queue query normalization and stage counts;
- bulk action aggregation.

### Route tests with mocked boundaries

- every mutation's 401/403 behavior;
- regenerate request validation and mixed results;
- manual/scheduled publish parity;
- post-external failure matrix;
- review transaction rollback behavior;
- partial SEO analysis responses;
- paginated API response and UI error handling.

### Real PostgreSQL integration tests

- conflict-do-nothing canonical creation;
- parallel insert races;
- interactive transaction conflict behavior;
- conditional generation completion after rejection;
- publish claim exclusivity;
- rollback of proposal plus audit/history/Opportunity transactions;
- full and upgrade migration paths.

### UI/component-helper tests

- GA4/GSC freshness copy;
- page-one, load-more, and retry states;
- server totals and filter reset;
- bulk approval partial failures;
- reopen row/bulk parity;
- published-with-warning and reconciliation-required banners.

### Safety tests

- no implementation test calls Shopify, Meta, SSH, deployment, or a production database;
- mutation handlers authenticate/authorize first;
- cron auth and job lock order remains correct;
- server secrets remain absent from client code;
- pause_ad guardrail membership remains unchanged.

## Implementation Sequence

The later implementation plan will decompose this design into red-green tasks. The required dependency order is:

1. PostgreSQL integration harness and explicit Prisma/CI generation gates — F12, F16, F17.
2. Permission matrix and complete transition predicates — F02, F14.
3. Transactional review/edit/schedule helpers — F10.
4. Durable generation ownership and rejection interleavings — F06.
5. Shared publish claim, receipt, finalizer, warning, and reconciliation services — F03, F04, F05.
6. Secure bounded Filipino regeneration through shared services — F01.
7. PostgreSQL-safe canonical creation and transactional proposal/Opportunity replacement — F09, F16.
8. SEO deterministic partial analysis and multi-candidate structured parsing — F07, F18.
9. GA4 arbitration and visible freshness — F08, F15.
10. Server pagination, truthful counts, bulk-result chaining, and reopen UI parity — F11, F13, F14.
11. Cross-pilot integration verification, migration upgrade tests, GROW documentation, and whole-branch review — every finding.

Every task must use red-green TDD, a fresh implementation subagent, a specification review, a code-quality review, focused verification, GROW, and a task commit. Review findings are resolved before the next task starts.

## Rollback Strategy

- Work remains isolated until all tasks and gates pass.
- Each task is a small independent commit and can be reverted without discarding later evidence.
- Schema changes are additive and nullable. Rolling application code back does not require a down migration.
- Existing migration files are not edited after deployment; any correction is a new forward migration.
- No implementation verification performs a live publish, so application rollback cannot need to undo verification-created Shopify state.
- After final merge, deployment remains a separate operator-authorized action.
- If a post-deployment publish finalization issue occurs, the durable receipt and reconciliation states prevent blind retry; they do not disable the publish feature.

## Final Verification and Merge Criteria

The branch cannot be declared complete or merged until all of the following are true:

1. Every F01–F18 traceability row links to implementation commits and passing tests.
2. Every task's specification and code-quality reviews have no unresolved finding.
3. All focused SEO, Content Pilot, auth, queue, AI, publish, Opportunity, and migration suites pass.
4. Real non-production PostgreSQL migration and concurrency suites pass.
5. Full npm test passes.
6. npm run db:generate passes.
7. npm run typecheck passes.
8. npm run typecheck:test passes.
9. npm run lint passes with zero errors.
10. npm run build passes.
11. Prisma validate passes with a non-production URL.
12. npm audit at the repository-required threshold passes.
13. Secret scan and authentication-order checks pass.
14. git diff --check passes.
15. The explicit project Verify Checklist is recorded item by item.
16. GROW updates describe the final behavior, migration names, concurrency rules, and operator recovery flow.
17. A whole-branch review confirms no unrelated changes, weakened invariant, disabled feature, or hidden deferral.
18. The working tree is clean and the final repository status is reported.

Only then is the complete branch merged once into main. Pushing or deploying is not part of this design-stage task, and production deployment remains separate.

## Explicit Scope Confirmation

- No feature is disabled.
- No feature is removed.
- No rebuild is proposed.
- No confirmed defect is deferred.
- No suspected risk is left as documentation-only.
- No live action is authorized by this design.
- All eighteen findings are included in the implementation and final-gate definition of done.
