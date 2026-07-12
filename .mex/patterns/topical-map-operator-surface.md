---
name: topical-map-operator-surface
description: Render authenticated, read-only topical-map strategy governance without leaking source artifacts or offering unauthorized lifecycle actions.
triggers:
  - "topical-map operator UI"
  - "strategy governance observability"
  - "strategy package panel"
edges:
  - target: topical-map-activation-persistence.md
    condition: when changing package route projections or lifecycle information
  - target: ../../app/(embedded)/(seo-pillar)/seo-pillar/components/useSeoData.ts
    condition: when loading strategy governance inside SEO Pilot
last_updated: 2026-07-12T23:59:00+08:00
---

# Topical-map Operator Surface

## Context

The SEO Pilot strategy panel is an authenticated read-only observer. The current July 12 package is approved for validation/import eligibility only: activation eligibility and runtime activation authorization are both false.

## Steps

1. Keep the package route's `await requireAppAuth(req)` as its first statement and use `prisma` from `@/lib/db`.
2. Project only package identity/lifecycle, validation issue summaries, freshness gates, bounded compliance evidence, source artifact identifiers, and bounded activation/rollback audit fields.
3. Bound and deterministically order package, compliance, and audit reads. Parse JSON server-side into explicit fields; never return raw manifests, contracts, compiled payloads, source prose, `rawContent`, or arbitrary audit JSON.
4. Surface loading, unavailable, empty, partial, active/inactive, validated, stale-evidence, rejected, superseded, and rolled-back states explicitly. A partial response must remain visibly partial.
5. Keep lifecycle controls fail-closed. Do not render or call activation/rollback unless separately server-projected authorization and lifecycle eligibility are both true.

## Verify

- `npm test -- __tests__/components/topical-map-strategy-panel.test.ts __tests__/api/topical-map-routes.test.ts`
- `npm test -- __tests__/components/use-seo-data.test.ts __tests__/components/seo-pilot-responsive.test.ts`
- `npm run typecheck && npm run typecheck:test && npm run lint && git diff --check`

## Gotchas

- `AuditLog.meta`, validation reports, and compliance JSON are server-side source data, not browser contracts. Shape every returned field deliberately.
- The SEO Pilot keyword `StrategyPanel` owns lifted track/plan state; compose this panel above it rather than moving its handlers.
- Activation/import APIs remain separately permission-enforced. This read panel must not infer authority from a lifecycle label.
