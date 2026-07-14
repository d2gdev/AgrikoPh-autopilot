---
name: strategy-bound-seo-command-center
description: Keep SEO analysis, command-center UI, and proposal actions fresh against the exact active topical-map identity.
triggers:
  - "strategy-bound SEO analysis"
  - "SEO command center freshness"
  - "topical-map proposal promotion"
edges:
  - target: topical-map-operator-surface.md
    condition: when changing the authenticated command-center projection or five-job UI
  - target: seo-pilot-proposal-actions.md
    condition: when changing governed Content Pilot proposal creation
last_updated: 2026-07-14T12:46:00+08:00
---

# Strategy-bound SEO Command Center

Executable non-blog synchronization must create or link an exact pending Recommendation. Stable task identity excludes proposal bytes; keep the proposed hash as separate execution evidence. Confirmation only approves/queues, while `execute-approved` revalidates and serializes the normalized Shopify target before mutation.

Once the linked Recommendation is approved, override-approved, or executing, synchronization must not overwrite task bytes. Approval freezes the strict hash, and dispatch compares it before any lock, observation, or mutation.

## Context

SEO observations are evidence, not governance. Only the active `agrikoph.com` topical-map projection may classify a missing page or absent required link as promotable. The strategy version ID, package SHA-256, exact rule IDs/domains, and safe source references travel together from projection through analysis and proposal persistence.

## Steps

1. Load the command center through the authenticated, private/no-store route; never expose raw artifacts or compiled payloads.
2. Persist analysis in the versioned envelope with the exact active version ID and package hash.
3. On read, return `stale` with `analysis: null` when the cached identity differs; never leak or render the old findings.
4. Keep unmapped GSC demand in the separately labelled observation view. Do not provide a promotion action until an active map rule governs it.
5. For content or internal-link promotion, reconstruct the candidate from the current server projection and reject stale identity, unrelated rule IDs, altered evidence, or incomplete link pairs before persistence.
6. Persist a deterministic candidate ID from strategy identity, kind/action, normalized URLs, and sorted rule IDs. Selected promotion sends the exact analysis timestamp/strategy identity plus at most 100 IDs, reloads current server evidence, and commits each candidate independently through the existing evaluator/compliance/dedupe transaction.
7. Redirects use the existing Store Task lifecycle only for create-when-exact-source-is-absent. Matching redirects are satisfied; conflicting exact sources stay advisory and are never updated automatically. Canonicalization and indexation remain advisory-only.
8. When removing a legacy strategy surface, delete its module, unreachable panels/handlers/tabs, and add a recursive runtime-source regression scan so hidden fallback code cannot return.
9. After the exact active-map analysis snapshot is persisted, synchronize non-blog Store Tasks as an independent best-effort step. Return only bounded counts, preserve analysis readiness on sync failure, and keep the standalone sync route for operator retry.
10. Project the compiled page title separately from `primaryKeywordOrTheme`: the title drives the Content Gap/proposal heading, while the keyword remains the target query. Normalize P0/P1/P2/P3 only for UI bands and badge tones; preserve original priority strings in advisory Store Tasks.
11. Classify non-blog page mutations from explicit decision language only. Generic keep/preserve/indexation/publication/conditional/optimize/strengthen language creates no executable body or metadata task. Reuse that classifier during execution revalidation.
12. Refresh bounded priority/canonical/decision/evidence fields on an existing pending or failed canonical/index advisory without changing semantic identity; a second identical synchronization must be unchanged.

## Gotchas

- A valid rule ID is insufficient if it belongs to a different projected candidate.
- Client-authored map evidence is untrusted even when strategy identity matches.
- Blog refresh candidates remain governed by exact active-map reconstruction. Non-blog Store Tasks require an explicit metadata or body-content instruction; generic optimize/strengthen wording is insufficient.
- A newer active pointer invalidates cached analysis immediately; timestamps alone do not establish freshness.
- Local builds must use the exact non-production `autopilot_test` URL and include `connection_limit` and `pool_timeout`; never source production credentials for a build.
- Inspection completeness must use the same executable scope as analysis. Non-blog Shopify objects that Content Pilot deliberately suppresses must remain visible as unsupported findings, but must not make fully inspected blog actions globally unavailable.
- Never route governed blog articles into Store Tasks; blog create/refresh/link work remains in Content Pilot, while Store Tasks cover supported non-blog Shopify resources.
- Treat a blog article as `(blogHandle, handle)` everywhere. Normalize exact `/blogs/<blogHandle>/<handle>` paths for absence, links, reconstruction, and publish revalidation; a same-handle article in another blog is not evidence.
- Shopify resource `updatedAt` detects source changes; local `capturedAt` establishes observation freshness. For AI drafts, keep each request at 25 candidates but iterate every deterministic chunk so later candidates are not starved.
- Do not label redirect rules candidate, blocked, satisfied, or conflicting from compilation alone. SEO Pilot points operators to Store Pilot; only its exact-source observation may assign the operational state.
- Do not turn a missing blog-link candidate into a blocker. Use persisted suppression evidence for unavailable observations, route non-blog sources to Store Pilot, and otherwise show a neutral no-candidate state.

## Verify

- Run the focused Task 7 eight-file Vitest gate.
- Run `npm test`, `npm run lint`, and `git diff --check`.
- Run `DATABASE_URL='postgresql://test:test@127.0.0.1:5432/autopilot_test?connection_limit=10&pool_timeout=10' npm run build`.
- Confirm route/auth tests cover auth-before-Prisma, exact identity, bounded projection, and source-byte exclusion.
- Confirm analysis/promotion tests cover stale withholding, exact rule-context persistence, unrelated observation rejection, and transaction-time strategy changes.
- Confirm UI source tests cover five operator jobs, all eleven domains, legacy June removal, and canonical/indexation live-execution prohibition.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` with fresh gate evidence and deployment state.
- [ ] Update `.mex/context/architecture.md` if identity or persistence boundaries change.
- [ ] Record deployment evidence only after server commit, build, PM2, health, authenticated UI/API, and no-live-write gates are freshly observed.
