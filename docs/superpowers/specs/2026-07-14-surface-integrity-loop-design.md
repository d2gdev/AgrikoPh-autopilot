---
title: Surface integrity loop design
status: approved-for-spec-review
last_updated: 2026-07-14
---

# Surface Integrity Loop

## Goal

Provide a named local Codex loop command that audits and repairs the Autopilot
operator surfaces. It must not report success until it has completed five
consecutive clean passes. A pass that finds a defect is not clean, even when
the defect is fixed and its tests pass during that same pass; the clean-pass
counter resets to zero.

The command is authorized to make local code, UI, persistence, test, and
project-record changes. It is not authorized to access production, deploy,
write to Shopify or Meta, activate a strategy, modify production data, change
credentials or permissions, or perform destructive or irreversible work.

## Operator command

Add a `codex:surface-loop` command family that always selects a dedicated,
portable loop configuration and the versioned surface-integrity prompt. The
start command must be runnable from the repository root without pointing at
the stale historical worktree used by the existing default controller config.

The command family supports start, status, and resume. It retains the existing
controller's private run evidence under `.codex-agent-loop/runs/` and its
approval pauses. It must use a finite iteration ceiling high enough to allow
five clean passes plus bounded repair cycles, while retaining the existing
timeout and protected approval scopes.

## Audit scope

Every pass reviews the UI, API projection, and persisted data lifecycle for:

- Campaigns: Campaigns, Recommendations, Ad Approvals, and Reports.
- SEO Pilot: SEO.
- Store Pilot: Images and Reports.
- Content Pilot: Content.
- Social Pilot: Social.
- Market Intelligence: Competitors and Insights Pilot.
- Growth Brief.
- Unified Report.

The topical-map strategy is an authority only where it applies: SEO Pilot,
Content Pilot, and governed Store Pilot work. Those surfaces must expose and
persist the applicable map-derived identity, rules, values, analysis,
evidence, status, timestamps, and actionability constraints without leaking
raw package bytes. Other surfaces are audited against their own authoritative
data contracts; the loop must not invent topical-map requirements for ads,
social, market intelligence, or reporting.

## Pass protocol

Each pass performs these lenses in order:

1. Discover the current surface route, component, service, schema, and tests;
   compare the supported UI behavior with the active source-of-truth contract.
2. Verify API/DTO/UI field parity, including derived analysis, counts,
   status/priority values, evidence, timestamps, pagination, and bounded
   detail where the surface requires it.
3. Verify persistence and reload behavior: creation or refresh, retrieval,
   identity binding, stale/empty/error states, and that values displayed to an
   operator have a truthful persisted or explicitly computed provenance.
4. Verify safety and operator experience: loading, empty, stale, failed,
   unavailable, permission, and non-actionable states; governed UI must fail
   closed and retain approval/execution separation.
5. Run focused regression coverage for inspected behavior, then proportional
   type, lint, build, database-client, and full-test verification required by
   the actual changes.

When a lens finds an issue, the executor diagnoses it, implements only the
authorized local repair, adds or updates a regression test before relying on
the repair, runs verification, records the evidence, and resets the
consecutive-clean-pass counter. A failure to verify, an incomplete diagnosis,
or an approval boundary is never a clean pass.

## Completion and reporting

The loop prompt must maintain a visible pass ledger: pass number, lenses
covered, defects found, fixes made, verification evidence, and the resulting
consecutive-clean count. The planner may return `done` only when the ledger
contains five consecutive clean passes after the last defect and all required
verification has passed.

The final executor report states the five-pass evidence, changed local files,
verification commands and outcomes, and confirms that production was not
accessed, deployed, or changed. Any protected action uses the existing
controller approval pause rather than proceeding.

## Implementation boundaries

The implementation adds a dedicated prompt, configuration, ergonomic command
wrapper, and controller tests for profile selection and five-clean-pass exit
semantics. It does not change product behavior by itself, bypass controller
sandboxing, weaken protected approval scopes, expose private loop evidence,
or grant any new production authority.

## Verification

Regression tests must prove that the command selects the current workspace and
the dedicated prompt/configuration, that a repaired pass resets the counter,
that only five uninterrupted clean passes permit completion, and that a
protected action pauses. The command wrapper, JSON configuration, prompt
presence, focused tests, type checks, lint, and diff hygiene must pass before
the command is offered as ready to run.
