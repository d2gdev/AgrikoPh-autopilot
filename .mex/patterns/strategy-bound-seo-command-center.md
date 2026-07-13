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
last_updated: 2026-07-13T22:11:00+08:00
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
6. Preserve evaluator/compliance/dedupe evidence in the existing transaction. Redirect persistence remains unsupported; canonicalization and indexation remain advisory-only and must never advertise live execution.
7. When removing a legacy strategy surface, delete its module, unreachable panels/handlers/tabs, and add a recursive runtime-source regression scan so hidden fallback code cannot return.
8. After the exact active-map analysis snapshot is persisted, synchronize non-blog Store Tasks as an independent best-effort step. Return only bounded counts, preserve analysis readiness on sync failure, and keep the standalone sync route for operator retry.

## Gotchas

- A valid rule ID is insufficient if it belongs to a different projected candidate.
- Client-authored map evidence is untrusted even when strategy identity matches.
- Refresh/improve/optimize decisions for existing pages are governed content refreshes, not generic thin-content guesses.
- A newer active pointer invalidates cached analysis immediately; timestamps alone do not establish freshness.
- Local builds must use the exact non-production `autopilot_test` URL and include `connection_limit` and `pool_timeout`; never source production credentials for a build.
- Inspection completeness must use the same executable scope as analysis. Non-blog Shopify objects that Content Pilot deliberately suppresses must remain visible as unsupported findings, but must not make fully inspected blog actions globally unavailable.
- Never route governed blog articles into Store Tasks; blog create/refresh/link work remains in Content Pilot, while Store Tasks cover supported non-blog Shopify resources.

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
