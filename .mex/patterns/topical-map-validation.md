---
name: topical-map-validation
description: Deterministically validate a complete raw and compiled topical-map package without persistence or repair.
triggers:
  - "topical-map validator"
  - "strategy package validation report"
  - "topical-map evidence freshness"
last_updated: 2026-07-12T20:15:00+08:00
---

# Topical-map Whole-Package Validation

## Context

Run this pure server-only boundary only after package reading and compilation. It consumes already loaded `rawPackage`, `compiledPackage`, and an explicit ISO `asOf`; it never reads files, uses the wall clock, writes state, mutates input, or interprets source prose.

## Steps

1. Check exactly six artifact identities and raw byte hashes against the manifest; then parse the existing strict contract parser rather than duplicating its grammar.
2. Require matching manifest, contract, package, strategy, compatibility, rule, coverage, and bidirectional reference identities between raw and compiled projections.
3. Reject typed exclusive-owner, redirect-source, and canonical-source conflicts. Never select or repair a winner.
4. Iterate declared typed `source_required_evidence` requirements in rule/requirement order. Derive `${ruleId}:evidence:${zeroBasedRequirementIndex}` and compute UTC calendar-day age from manifest `evidenceDate` to injected `asOf`.
5. Emit only safe source artifact/locator provenance in blocking issues. Retain every evidence entry, including missing or stale gates, while blocking eligibility.

## Freshness

- `general_seo_market`: 180 days; `high_stakes`: 90 days.
- Equal age is current; only greater age is stale.
- Missing, malformed, future, or invalid timestamps are `missing` with `MISSING_EVIDENCE_GATE`; stale mandatory gates use `STALE_MANDATORY_EVIDENCE`.

## Boundary

Do not add filesystem reads, database work, persistence/import execution, activation, supersession, rollback, APIs, UI, source bytes/prose, or Task 5 behavior. Any conflict is an operator decision blocker, not a repair opportunity.
