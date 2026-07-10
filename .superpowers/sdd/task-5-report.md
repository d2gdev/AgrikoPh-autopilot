# Task 5 Report — Content Pilot publishing

## Status

Implemented and committed after fresh red-green service tests.

## What changed

- Added a shared publish service that claims an operation, re-reads the claimed proposal, records Shopify success before bookkeeping, and finalizes audit/Opportunity work retry-safely.
- Migrated manual and scheduled publishing to it; scheduled publishing retries incomplete bookkeeping without calling Shopify.
- Added a `CONTENT_PUBLISH`-protected reconciliation endpoint and operator warning/reconciliation copy.
- Added auth-first embedded publishing and cron locking for the reindex route.

## Verification

- `npm test -- --run __tests__/lib/content-pilot/publish-service.test.ts __tests__/api/content-pilot-publish-failure.test.ts __tests__/lib/content-pilot/publish-draft.test.ts __tests__/components/pilot-usability-helpers.test.ts` — 32 passed.
- `npm run typecheck` — passed.
- `npm run typecheck:test` — passed.
- `git diff --check` — passed.

## Concerns

- Shopify inspection helpers do not yet expose a proposal-type-specific read API. Reconciliation is intentionally conservative: it finalizes a durable published receipt, returns ready only for an operation with no recorded Shopify ID, and otherwise leaves an ambiguous state for operator inspection. No live Shopify mutation is issued.

## Specification follow-up — 2026-07-10

### Red evidence

- `npm test -- --run __tests__/lib/content-pilot/publish-service.test.ts __tests__/lib/content-pilot/publish-reconciliation.test.ts __tests__/api/content-pilot-publish-failure.test.ts` initially failed three regressions: local SEO context could throw after Shopify success before receipt persistence; a receipt-less `publishing` row was reset to `ready`; and the scheduled path reindexed each item rather than the batch.

### Green evidence

- Local SEO/blog-context lookup failures after Shopify success now record the minimal receipt first and return `published_with_warnings`; no post-success path invokes ordinary recovery.
- Receipt write failures remain `reconciliation_required`; no recovery update resets the operation to `ready`.
- Reconciliation never treats a missing local receipt as proof of non-application. It remains an explicit ambiguous, reconciliation-required state unless future authenticated proposal-type Shopify inspection proves not-applied.
- `publishActor` and `publishTrigger` are persisted in migration `20260710190000_content_proposal_publish_audit_metadata`; finalizer audit `action`, `actor`, and `meta.trigger` therefore remain correct for manual, scheduled, and delayed-finalizer work.
- Scheduled publishing passes IDs to the shared service with per-item reindex disabled, then runs one reindex after the batch and reports a batch-level warning while preserving truthful per-item outcomes.
- Queue and draft review expose a `CONTENT_PUBLISH`-protected Reconcile action for `publishing` and `publish-error` states.
- Final focused run: `npm test -- --run __tests__/lib/content-pilot/publish-service.test.ts __tests__/lib/content-pilot/publish-reconciliation.test.ts __tests__/api/content-pilot-publish-failure.test.ts __tests__/lib/content-pilot/publish-draft.test.ts __tests__/components/pilot-usability-helpers.test.ts` — 36 passed.
- `npm run typecheck` — passed; `npm run typecheck:test` — passed; `git diff --check` — passed.

## Final specification completion — 2026-07-10

### Red evidence

- The new receipt-order test failed with the receipt update after the local SEO enrichment call (`2` was not less than `1`), proving a Shopify-success exception could precede durable receipt storage.

### Green evidence

- Receipt persistence now occurs immediately after `publishDraft`; all SEO/blog context enrichment follows it and turns failures into a published warning.
- The receipt preserves the resolved existing article handle for baseline and 14-day follow-up-score eligibility.
- Manual and scheduled paths have receipt parity and truthful trigger-specific audit metadata; stale scheduled rows still reach `publishDraft` only through the claimed fresh read.
- Opportunity, audit, and reindex failure matrix keeps published state; scheduled reindex failure additionally writes the warning to every successfully published row.
- A `CONTENT_PUBLISH`-protected `retry-bookkeeping` route and queue/draft action call only the idempotent finalizer. Two retries create exactly one audit.
- Final focused run: 43 passing tests across Task 5 service/reconciliation/publish-failure/publish-draft/UI helper suites; `npm run typecheck`, `npm run typecheck:test`, and `git diff --check` pass.
