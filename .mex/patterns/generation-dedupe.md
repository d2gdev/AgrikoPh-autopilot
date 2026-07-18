---
name: generation-dedupe
description: Prevent generated recommendations, proposals, opportunities, and tasks from recreating ideas the operator already handled.
triggers:
  - "regenerating old recs"
  - "already finished ideas"
  - "duplicate recommendations"
  - "duplicate proposals"
  - "clear queue"
  - "start from scratch"
last_updated: 2026-07-18T18:47:59+08:00
---

# Generation Dedupe

## Context
Autopilot has multiple idea generators: skill recommendations, insight-derived actions, Content Pilot proposals, SEO promote routes, and opportunities. A clean queue is not enough; generators must also check terminal history so rejected, executed, published, resolved, or dismissed ideas do not return as fresh work.

## Steps
1. Identify every creation path for the entity, not just the UI action being debugged.
2. Keep history rows. Prefer status transitions or recreate-blocking status checks over deleting old decisions.
3. Use shared status constants:
   - Recommendations: `RECOMMENDATION_RECREATE_BLOCKING_STATUSES`.
   - Content proposals: `CONTENT_PROPOSAL_RECREATE_BLOCKING_STATUSES` for direct/manual/promotion routes.
   - Content proposal replacement jobs: `CONTENT_PROPOSAL_REPLACEMENT_BLOCKING_STATUSES`, intentionally excluding `pending` so pending queues can be refreshed while still blocking rejected/published ideas.
4. Check terminal history using the logical idea key, not just the row id.
   - Recommendations: platform + actionType + targetEntityId.
   - Article proposals: proposalType + articleHandle.
   - Handle-less proposals: proposalType + target keyword/query/title discriminator.
   - Opportunities/tasks: dedupeKey plus status handling.
   - When a task has an immutable source identity, derive its key from task type + source type + source key. Keep editable titles and target URLs out of the key, and query the immutable identity alongside the new key while legacy rows still carry the older key format.
5. When a queue is intentionally reset, mark or remove only transient pending rows. Do not remove rejected/published/executed rows that act as tombstones.
6. Persist a canonical proposal `dedupeKey` with a database unique constraint. Create-first flows must return the existing row on `P2002` races; historical collisions retain one canonical row and receive stable `:history:<id>` keys.

## Gotchas
- Checking only `status: "pending"` prevents simultaneous duplicates but allows rejected/executed work to come back tomorrow.
- Content Pilot daily generation deletes pending proposals before recreating fresh ones; this is not a historical reset and must still block rejected/published ideas.
- SEO routes can bypass Content Pilot generation, so they must use the same recreate-blocking constants.
- Bulk/manual bypass routes such as Content Pilot `refresh-all` and SEO recommendation decomposition must also use the shared logical key (`contentProposalDedupeKey`) or recreate-blocking statuses. Title-only checks are not enough because AI can reword the same article action.
- Opportunity routing is another bypass path; rejected content ideas can return through it if it checks only active proposals.
- Store task upserts should not set terminal rows back to pending unless the operator explicitly reopens them.
- A generation token is durable ownership, not just a lock. Every conditional validation/failure write must inspect `updateMany.count`; a zero count means ownership was lost and must return a discarded/conflict result, never overwrite the current proposal as failed.
- Receipt-preserving generation still excludes `draftStatus: "publishing"` from its claim predicate. It persists ownership only through the token/start timestamp so the visible published status and receipt remain stable while AI runs.
- A Prisma `notIn` predicate does not claim SQL `NULL`; pair the active-status exclusion with an explicit `draftStatus: null` branch. Preserve the visible status only when it is actually `published`; otherwise a new generation must visibly enter `generating`.
- Do not choose receipt preservation from a proposal read before claiming ownership. For preservation requests, atomically try the `published` predicate with token-only data, then separately try a non-published predicate that writes `generating`; this covers published→ready and ready→published races without hiding work or overwriting a live receipt.
- Do not make a best-effort side write after clearing an ownership token. Collect optional data before finalization and persist it in the token-guarded transaction, or use an equivalent version guard.
- For actionable task lists, batch-check displayed open rows against terminal audit receipts and terminal rows sharing their immutable source identity. Keep inconsistent rows visible for reconciliation, remove their mutation controls, and repeat the check inside the mutation transaction so a stale browser cannot act after another completion. Describe this narrowly as a durable-record check; do not imply that an external platform state was verified unless that source was actually queried.
- For rolling topical-map tasks, use `topical-map-phase:<strategyVersionId>:<startDay>-<endDay>` as the immutable source key. Daily reconciliation may create a missing current-version phase or cancel an open prior-version phase through the audited mutation service, but it must never reopen or recreate a completed/cancelled identity.
- For exact-map content candidates, preflight both the current exact-URL proposal key and the legacy handle-only key. Apply the same shared check when listing candidates, before expensive brief generation, and inside the queue transaction so historical rows and stale clicks cannot recreate finished work.
- Use `topical-map-content:<strategyVersionId>:<candidateId>` for exact mapped content tasks. Reconcile against both completed task history by logical URL/action and recreate-blocking Content Proposal history. Content Pilot must require the corresponding Ready task before brief or proposal mutation, and proposal creation must trigger task reconciliation so it cannot remain as a separate actionable backlog.
- Queue dedupe does not prevent semantic duplication inside an AI-written brief. For exact-map work, build the brief deterministically from the mapped page assignment, same-cluster ownership boundaries, and exact mapped links; do not let a model elaborate adjacent topics, URLs, claims, or link targets beyond the contract.
- Persisted analysis is evidence, not the current actionable queue. Every surface that renders its content candidates must batch-filter them through current Ready mapped tasks and recreate-blocking proposal history; keep link findings intact and repeat the same check at mutation time.

## Verify
- Add regression coverage for at least one terminal status (`rejected`, `executed`, `published`, `dismissed`, or `completed`) blocking regeneration.
- Run the focused generator test suite plus `npm test`, `npx tsc --noEmit`, and `npm run build`.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` Current Project State if generation behavior changed.
- [ ] Update this pattern when adding a new generator or a new terminal status.
