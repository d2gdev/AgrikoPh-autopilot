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
last_updated: 2026-07-10T22:52:00+08:00
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
- Do not make a best-effort side write after clearing an ownership token. Collect optional data before finalization and persist it in the token-guarded transaction, or use an equivalent version guard.

## Verify
- Add regression coverage for at least one terminal status (`rejected`, `executed`, `published`, `dismissed`, or `completed`) blocking regeneration.
- Run the focused generator test suite plus `npm test`, `npx tsc --noEmit`, and `npm run build`.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` Current Project State if generation behavior changed.
- [ ] Update this pattern when adding a new generator or a new terminal status.
