---
name: pilot-queue-usability
description: Make pilot queues trustworthy after dedupe, cleanup, or terminal-state changes.
triggers:
  - "queue is confusing"
  - "why does this still appear"
  - "already handled"
  - "not usable"
  - "old recommendations"
edges:
  - target: patterns/generation-dedupe.md
    condition: when stale or finished ideas are being regenerated
last_updated: 2026-07-13T22:11:00+08:00
---

# Pilot Queue Usability

For executable topical-map Store Tasks, keep list DTOs preview-only and fetch exact before/after detail from the authenticated task detail route when the operator confirms. The Apply label means approve-and-queue: it must approve the linked Recommendation and must not call Shopify. Show failed and uncertain-receipt notes, and retry only through re-sync/reobservation.

Applying and reconciliation-needed work must remain visible. A failed row's recovery control always invokes synchronization/reobservation; never expose a blind replay endpoint.

## Context
Backend dedupe is not enough. Operators need to see why a row exists, why a queue is empty, and whether rejected/published/executed history is being respected.

## Steps
1. Preserve terminal history rows; do not delete rejected/published/executed/dismissed rows just to make a queue look clean.
2. Confirm list APIs return the lightweight evidence fields the UI needs. For Content Pilot this includes `ContentProposal.sourceData`; keep full draft HTML out of list responses.
3. Add a visible "why shown" or reason summary before the primary action buttons.
4. Filter AI-generated strategy bullets before display. Keep only items grounded in real articles, GSC queries, or current issue counts, and render per-item evidence beside every visible quick win/recommendation.
5. Empty states must distinguish:
   - truly no rows,
   - current filters/search hiding rows,
   - a clean actionable queue because terminal history/dedupe blocked old ideas.
6. Terminal states need explicit badges; do not fall through to unlabeled fallback UI.
7. Publish failures that cannot succeed on retry without operator intervention must move to a visible failed state with the original error retained.
8. Content Pilot proposals must remain rejectable until publishing starts. The Reject action should be available for approved, ready, scheduled, failed, and other pre-publish states, and hidden only once a proposal is already rejected, publishing, or published.
9. Rejection must atomically make the proposal non-publishable: set both proposal and draft state to rejected and clear `scheduledPublishAt`. Manual publish, scheduled publish, and scheduling mutations must independently require approved/override-approved status as well as `draftStatus: "ready"`; repeat those conditions in their optimistic write predicates.
10. Scheduled publishing must use a route-level job lock in addition to its per-proposal optimistic lock.
11. Keep helper logic pure when possible so tests can lock the wording and evidence extraction without a browser.
12. Use this Task 2 permission matrix exactly: every listed embedded handler first calls `await requireAppAuth(req)`, then immediately calls `requirePermission(req, PERMISSIONS.CONTENT_REVIEW)` before any boundary: `POST /api/content-pilot/proposals/[id]/{reject,reopen,clone,generate-draft}`, `PATCH /api/content-pilot/proposals/[id]`, `POST /api/content-pilot/proposals/{generate,manual,refresh-all}`, `POST /api/seo/promote`, `POST /api/seo/gaps/promote`, and `POST /api/seo/recommendations/decompose`. Reads stay on `requireAppAuth`. This is not a publication matrix: `POST /api/content-pilot/regenerate-filipino` is mandatory Task 6 remediation and must use `CONTENT_PUBLISH`; Task 2 neither fixes nor defers it.
13. Shopify success is final for the operator: write a durable published receipt before any audit, Opportunity, or reindex work. Any bookkeeping failure remains `published` with `publishWarning`; only a receipt that cannot be stored requires reconciliation, never an automatic republish.
14. A published receipt with `publishFinalizedAt: null` needs an explicit "Retry bookkeeping" action protected by `CONTENT_PUBLISH`; it may call only the idempotent local finalizer, never Shopify. Batch reindex failure must persist its warning on every affected published row.
15. Reconciliation must inspect Shopify through proposal-specific read-only evidence before resetting any interrupted publish: exact article content for new/refresh work, exact metafields for SEO, and the operation marker for internal links. A missing or non-deterministic result is ambiguous, never retryable. Queue stages must expose `publishing`/`publish-error` so Reconcile is reachable, and successful warning responses must say “Published with warning.”
16. Treat `202`/`reconciliationRequired` publish responses as critical uncertainty, never a published success: preserve the existing queue state, show the reconciliation error, and reload the authoritative row. When a scheduled batch reindex fails, retain every individual `PublishResult.warning` and combine it with the batch warning in both the returned per-item result and the durable `publishWarning`.
17. Keep queue and detail recovery state consistent. List responses must include `publishWarning`, `publishOperationId`, and `publishFinalizedAt`; draft detail must apply the same `202` reconciliation rules as the queue.
18. Scope browser queue caches by Shopify context. Load all cursor pages, use the first-page `total` as a consistency bound, reject malformed/repeated cursors, and never impose a hidden row cap.
19. Coordinate overlapping UI loads. Background polls must skip while a load is active; foreground or post-mutation refreshes may supersede and abort older work; only the current request may commit or clear loading state. If generation and its authoritative reload both fail, restore the pre-generation row and retain the original generation error.
20. Protect Run Indexer and Content Brief with `CONTENT_REVIEW`. Return safe operator errors rather than raw provider or Shopify details.
21. Route every `fetchBlogContentHandler` production entry point through one owner-token lock wrapper. A denied lock means another index is active; only the owner that acquired the lock may release it.
22. Overview counts must load the complete paginated article corpus, and overlapping refreshes must prevent older results from overwriting newer state.
23. For executable topical-map Store Tasks, confirmation starts Apply but does not prove completion. Revalidate the active strategy and exact live before-state, perform only the supported Shopify mutation, persist the success receipt, and only then mark the task completed. Advisory tasks never expose Apply.

## Gotchas
- A successful "skipped/already handled" backend response still feels broken if the UI leaves the same row visible or says to fetch data first.
- Dropping `sourceData` from list payloads saves bytes but makes generated work impossible to trust.
- A queue reset should clear transient actionable rows, not historical tombstones that prevent regeneration.
- Free-text AI strategy output can look useful while being unrelated to actual site data. Validate and evidence it at the API boundary before the UI can plan it into Content Pilot.
- A missing target Shopify article is not a transient refresh failure. Mark it `draftStatus: "failed"` so it leaves the ready queue and tells the operator to recreate or reject it.
- Do not gate Content Pilot rejection on `status === "pending"` only. Operators can change their mind after approval or draft generation, up until live publish begins.
- Never let `draftStatus: "ready"` alone authorize a Shopify write. A rejected or concurrently modified proposal must fail the publish status predicate even if stale draft state remains.
- `requirePermission` verifies the embedded identity again while checking roles, but the project-wide embedded-route contract is stricter: `requireAppAuth` remains the first handler statement and permission follows immediately. Test both the unauthenticated short-circuit and the authenticated-but-forbidden path.
- A polling interval can continuously abort an unbounded pagination request and leave loading state stuck. Skip background polls while active and bound page traversal using the server's truthful total.
- A local lock at only one route is not a job invariant. Cron aggregation, scheduled publishing, shared publish services, source refreshes, scripts, and dashboard refreshes must all use the same lock wrapper.
- Do not replace a concrete mutation failure with a secondary reload failure. Preserve the primary message and roll back optimistic state if no authoritative state can be loaded.
- Never mark an executable map task complete from a request acknowledgment or local state update. Completion requires the persisted Shopify receipt; missing receipt evidence remains failed/reconcilable, not complete.

## Verify
- Add or update a route/API regression proving list responses include the evidence fields the row renders.
- Add focused helper or component coverage for reason text and terminal-state copy.
- Run targeted tests, `npm test`, `npm run typecheck`, and `npm run build`.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` Current Project State if operator-visible behavior changed.
- [ ] Update `patterns/generation-dedupe.md` if a new generator or terminal status is involved.
