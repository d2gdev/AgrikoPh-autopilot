---
name: topical-map-policy-evaluation
description: Deterministically evaluate a caller-supplied governed topical-map proposal, or persist the resulting evidence through the separate atomic compliance-store boundary.
triggers:
  - "topical-map evaluator"
  - "strategy compliance"
  - "governed proposal evaluation"
last_updated: 2026-07-19T02:50:00+08:00
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
7. Content and SEO metadata candidates require an exact normalized `content_decisions` URL plus a compatible create, refresh, or metadata instruction. Unmapped, keep-only, prohibited, manual-gate, activation-blocked, conditional, and action-mismatched candidates fail closed; explicit high-stakes classification is evaluated only after that exact content authority is established.

## Verify

- `npm test -- __tests__/lib/topical-map/evaluator.test.ts`
- `npm run typecheck`
- `npm run typecheck:test`
- `npm run lint`
- `git diff --check`

## Boundary

Do not add active-pointer queries, Prisma work, APIs, proposal writers, compliance persistence, activation, deployment, Shopify/Meta work, LLM calls, gate waivers, or technical execution to this slice.

## Task 8 Persistence Adapter

`lib/topical-map/compliance-store.ts` is deliberately outside the pure evaluator boundary. It runs inside the proposed `ContentProposal` transaction and must:

1. Select only the `agrikoph.com` active pointer, `active`/`valid` version, exact six artifacts, persisted compiled rule payloads, and lossless stored validation report. Missing or incoherent stored state is `unavailable_strategy`; it never reads package files or recomputes freshness.
2. Build candidates only from explicit structured route/proposal fields. Never turn an AI description into an authoritative URL, owner, evidence condition, or high-stakes classification.
3. Call `evaluateStrategyPolicy` before proposal creation. `compliant` and `needs_high_stakes_review` create normal pending review proposals; every other result creates no `ContentProposal` and returns safe evidence. High-stakes outcomes remain unapproved and set no draft/publish/execution state.
4. For a newly created proposal, write the normalized compliance row and a JSON-safe `sourceData.strategyCompliance` projection in the same transaction. Keep `executionAuthorized: false`; an existing deduplicated proposal never receives replacement provenance.
5. For a governed rejection with a real active version, retain candidate-level normalized compliance evidence. Never fabricate a version/package foreign key for `unavailable_strategy`.

## Task 9 Operation Adapter and Endpoint

`governed-operations.ts` reuses the Task 8 active-policy projection and the pure evaluator but returns proposal/review evidence only. Internal-link source/destination pairs must exactly match the declared normalized rule; declared redirect sources block targets. Redirect, canonical, and indexation pairs must be declared, retain `operator_review`, and use persisted validator freshness. Only explicit `medical`, `dosage`, `safety`, and `health` fields can trigger `manual_high_stakes_review`.

`POST /api/topical-map/evaluate` calls embedded auth first and `CONTENT_REVIEW` second, before parsing or reading the active pointer. Its strict candidate schema rejects prose-only fields and never returns raw strategy bytes.
