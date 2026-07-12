---
name: topical-map-policy-evaluation
description: Deterministically evaluate a caller-supplied governed topical-map proposal without selecting, persisting, or executing a strategy.
triggers:
  - "topical-map evaluator"
  - "strategy compliance"
  - "governed proposal evaluation"
last_updated: 2026-07-12T22:16:57+08:00
---

# Topical-map Policy Evaluation

## Context

`evaluateStrategyPolicy` is a pure boundary over an explicit `ActiveStrategyPolicy` and candidate. The caller, not this boundary, supplies the already-selected strategy, its six-artifact identity, compiled rules, and any validator report. It never reads files, queries a database or pointer, uses the wall clock, persists a compliance record, calls an LLM, repairs policy, or makes a live change.

## Steps

1. Normalize only explicit candidate URLs and context using `normalizeProposalContext`.
2. Require a coherent six-artifact identity matching the supplied compiled package; otherwise return `unavailable_strategy`.
3. Surface non-current validator freshness as `needs_evidence`; do not recompute freshness or inspect the clock.
4. Match only typed compiled-rule domains and explicit payload fields. Preserve contract rule IDs and safe source-locator provenance in the result.
5. Treat source-condition satisfaction as caller-supplied evidence keyed to contract coverage IDs; do not derive thresholds or semantics from prose.
6. Return `executionAuthorized: false` for every outcome. Redirect, canonical, and indexation candidates remain proposal/review evidence only and retain existing approval gates.

## Verify

- `npm test -- __tests__/lib/topical-map/evaluator.test.ts`
- `npm run typecheck`
- `npm run typecheck:test`
- `npm run lint`
- `git diff --check`

## Boundary

Do not add active-pointer queries, Prisma work, APIs, proposal writers, compliance persistence, activation, deployment, Shopify/Meta work, LLM calls, gate waivers, or technical execution to this slice.
