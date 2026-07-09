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
last_updated: 2026-07-09T23:55:12Z
---

# Pilot Queue Usability

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
9. Keep helper logic pure when possible so tests can lock the wording and evidence extraction without a browser.

## Gotchas
- A successful "skipped/already handled" backend response still feels broken if the UI leaves the same row visible or says to fetch data first.
- Dropping `sourceData` from list payloads saves bytes but makes generated work impossible to trust.
- A queue reset should clear transient actionable rows, not historical tombstones that prevent regeneration.
- Free-text AI strategy output can look useful while being unrelated to actual site data. Validate and evidence it at the API boundary before the UI can plan it into Content Pilot.
- A missing target Shopify article is not a transient refresh failure. Mark it `draftStatus: "failed"` so it leaves the ready queue and tells the operator to recreate or reject it.
- Do not gate Content Pilot rejection on `status === "pending"` only. Operators can change their mind after approval or draft generation, up until live publish begins.

## Verify
- Add or update a route/API regression proving list responses include the evidence fields the row renders.
- Add focused helper or component coverage for reason text and terminal-state copy.
- Run targeted tests, `npm test`, `npm run typecheck`, and `npm run build`.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` Current Project State if operator-visible behavior changed.
- [ ] Update `patterns/generation-dedupe.md` if a new generator or terminal status is involved.
