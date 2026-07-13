---
name: topical-map-operator-surface
description: Render the authenticated topical-map command center without leaking source artifacts or offering unauthorized lifecycle actions.
triggers:
  - "topical-map operator UI"
  - "strategy governance observability"
  - "strategy command center"
edges:
  - target: topical-map-activation-persistence.md
    condition: when changing package route projections or lifecycle information
  - target: ../../app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts
    condition: when loading strategy governance inside SEO Pilot
last_updated: 2026-07-13T12:31:00+08:00
---

# Topical-map Operator Surface

## Context

The five-tab SEO Pilot command center is the authenticated operator surface. It consumes bounded active-strategy projections and governed analysis while keeping package source material and lifecycle mutations outside the page.

## Steps

1. Keep the package route's `await requireAppAuth(req)` as its first statement and use `prisma` from `@/lib/db`.
2. Project only package identity/lifecycle, validation issue summaries, freshness gates, bounded compliance evidence, source artifact identifiers, and bounded activation/rollback audit fields.
3. Bound and deterministically order package, compliance, and audit reads. Parse JSON server-side into explicit fields; never return raw manifests, contracts, compiled payloads, source prose, `rawContent`, or arbitrary audit JSON.
4. Surface loading, no-active-strategy, unavailable, stale-analysis, and empty-analysis states explicitly.
5. Keep lifecycle controls outside the command center. Do not render or call activation/rollback from this surface.

## Verify

- `npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/api/topical-map-routes.test.ts`
- `npm test -- __tests__/components/use-seo-data.test.ts __tests__/components/seo-pilot-responsive.test.ts`
- `npm run typecheck && npm run typecheck:test && npm run lint && git diff --check`

## Gotchas

- `AuditLog.meta`, validation reports, and compliance JSON are server-side source data, not browser contracts. Shape every returned field deliberately.
- The five-tab SEO Pilot command center is the sole operator surface; do not restore the retired keyword `StrategyPanel`, hidden tabs, or lifted legacy track/plan handlers.
- Activation/import APIs remain separately permission-enforced. The command center must not infer authority from a lifecycle label.
