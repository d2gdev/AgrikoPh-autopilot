---
name: topical-map-contract-integrity
description: Validate an approved topical-map contract against hash-verified source bytes without compiling or inferring policy.
triggers:
  - "topical-map contract integrity"
  - "coverage inventory validation"
  - "compilation contract traceability"
edges:
  - target: ../../lib/topical-map/contract.ts
    condition: when parsing the strict contract grammar before integrity validation
  - target: ../../lib/topical-map/locator-resolver.ts
    condition: when resolving hash-bound Markdown or CSV source locators
last_updated: 2026-07-12T19:45:00+08:00
---

# Topical-map Contract Integrity

## Context

Run this server-only boundary after `readStrategyPackage` has hash-verified all six artifacts and `parseCompilationContract` has accepted the strict contract. It confirms the contract is a complete, anchored index. It neither compiles source policy nor interprets Markdown/CSV prose.

## Steps

1. Re-hash the five semantic artifact byte streams against the parsed contract source hashes.
2. Reject duplicate coverage, rule, or ambiguity identifiers and any missing coverage disposition.
3. Resolve every coverage locator and every rule source locator through the approved resolver. Preserve only artifact identity and coordinates.
4. Require each rule reference to name an existing, matching-artifact coverage unit; require the reciprocal coverage-to-rule pair; require every cited locator fingerprint in the rule's typed fingerprints.
5. Count CSV records structurally and require one coverage unit per URL inventory, redirect inventory, and internal-link row.
6. Reject duplicate exclusive ownership only from `url_intent_ownership` typed payload fields; never derive it from prose.
7. Reject any unresolved `activation_blocking` ambiguity. Return only safe count metadata on success.

## Evidence-freshness handoff

The strict contract requires every declared `source_required_evidence` item to set `mandatory: true`, an `evidenceClass`, and its matching maximum age: `general_seo_market` is 180 days and `high_stakes` is 90 days. The integrity boundary preserves these typed fields but does not evaluate wall-clock freshness. The Task 4 validator must accept `asOf` explicitly, use the manifest `evidenceDate`, derive a deterministic gate ID from rule ID plus zero-based evidence-requirement index, and retain missing/stale mandatory evidence in the report while blocking eligibility.

## Verify

- `npm test -- __tests__/lib/topical-map/contract-integrity.test.ts __tests__/lib/topical-map/contract.test.ts __tests__/lib/topical-map/locator-resolver.test.ts __tests__/lib/topical-map/manifest.test.ts __tests__/lib/topical-map/package-reader.test.ts`
- `npm run typecheck`
- `npm run typecheck:test`
- `npm run lint`
- `git diff --check`

## Boundary

Do not add compiler projections, policy evaluation, persistence/import/activation, APIs, UI, cron work, or source-content logging here. A failure in approved bytes is a material operator judgment blocker, not an invitation to edit or reinterpret protected sources.
