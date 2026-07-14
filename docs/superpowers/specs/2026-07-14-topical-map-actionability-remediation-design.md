# Topical-Map Actionability Remediation Design

**Date:** 2026-07-14  
**Status:** Operator-approved design  
**Scope:** Repair remaining topical-map actionability gaps without autonomous proposal creation, approval, publication, or execution.

## Goal

Make the active topical map more useful through the existing SEO Pilot, Content Pilot, and Store Pilot workflows. Recipe content must be recognized correctly, supported non-blog work must receive grounded drafts, redirects must use the governed Store Task lifecycle, and operators must be able to create selected proposal candidates efficiently.

## Explicit Boundaries

- No proposal is created merely because analysis runs.
- Selected SEO candidates become pending Content Proposals only; they are not approved, drafted, scheduled, published, or executed automatically.
- Redirects require the existing explicit Store Task confirmation, linked Recommendation approval, live-execution gate, immediate state revalidation, audited receipt, and reconciliation behavior.
- Canonicalization and indexation remain advisory-only because the active approved package explicitly prohibits their execution.
- Homepage and blog-index changes remain advisory-only in this remediation.
- No new queue framework, generic action engine, autonomous agent, or database model is introduced.

## 1. Exact Blog URL Recognition

The analysis layer currently reconstructs every `ArticleRecord` URL under `/blogs/news/`, which makes existing `/blogs/recipes/*` articles appear unobserved. The analyzer will instead receive or derive an exact governed URL for each observed article and compare normalized full paths.

The change must:

- recognize both `/blogs/news/<handle>` and `/blogs/recipes/<handle>`;
- retain exact strategy identity, rule IDs, observation timestamps, and evidence provenance;
- avoid treating the same article handle in a different blog as proof for the governed URL;
- preserve verified-absence behavior for genuinely missing governed blog URLs.

After production refresh, the current 76 recipe suppressions caused solely by the hardcoded news path should disappear or become truthful candidate/satisfied/prohibited states.

## 2. Grounded Non-Blog Drafts and Observations

Products, collections, and pages continue through Store Pilot rather than Content Pilot. Synchronization will use the existing Shopify observation boundary to construct a draft only when all required current fields are freshly observed and the map declares a supported content, SEO metadata, or internal-link change.

Supported drafts remain limited to the existing strict proposed-state shapes. Each draft records the target URL, target type and ID, observed-state hash, observation time, active strategy/package identity, matched rule IDs, and bounded before/after values. Missing or ambiguous evidence remains `draft_unavailable`; the system must not invent content or infer a target.

This work should convert the currently observed 35 `draft_unavailable` product, collection, and page tasks only where existing grounded evidence is sufficient. It does not promise that all 35 will become executable.

## 3. Governed Redirect Workflow

Redirect rules will become actionable Store Tasks when the map provides an exact source and final target and Shopify observation confirms the current redirect state. The task detail displays source, proposed target, observed current state, governing rules, and strategy identity.

Confirmation approves only the exact linked Recommendation. Execution remains exclusively in `execute-approved`, which must:

1. claim only the selected Recommendation;
2. revalidate the active strategy and exact redirect rule;
3. reobserve Shopify redirect state;
4. create or update only the declared source-to-target redirect;
5. persist a minimal Shopify receipt and atomically complete the Store Task and Recommendation;
6. supersede stale work or retain reconciliation work when the result is uncertain.

Existing redirects already matching the map become satisfied rather than executable. Conflicting or ambiguous redirect state remains advisory/reconciliation work. No redirect executes without approved status and `EXECUTE_APPROVED_LIVE_ENABLED=true`.

## 4. Selected Proposal Creation

SEO Pilot will add selection controls to map-derived content and internal-link candidates:

- select or clear an individual candidate;
- select all currently visible candidates;
- clear the current selection;
- create selected proposals with a single explicit confirmation.

The client sends bounded candidate identities, not arbitrary proposal bodies. The authenticated server route reloads the current analysis and active map, reconstructs each selected candidate, revalidates strategy identity, rule membership, observations, and current dedupe state, then invokes the existing governed proposal persistence path per candidate.

The operation returns bounded counts for created, already-existing, stale/blocked, and failed candidates. Independent candidates may succeed independently; failures never create incomplete proposals or opportunities. Repeating the same selection is idempotent.

There is no automatic selection and no background creation. The current 92 candidates remain untouched until an operator uses the dashboard action.

## 5. UI and Error Handling

SEO Pilot keeps the existing five-job information architecture. Selection is added only to Content gaps and Required internal links. Technical sections continue to state their execution boundary accurately.

Store Pilot uses the existing actionable/advisory split and task detail modal. Redirects display a precise preview before confirmation. Stale evidence, changed strategy, changed Shopify state, unavailable drafts, permission failures, and connector uncertainty use the existing typed conflict, superseded, failed, or reconciliation states rather than generic success or silent omission.

## 6. Verification and Release

Implementation follows test-first development. Required coverage includes:

- recipe and news URLs with identical and distinct handles;
- verified missing recipe URLs;
- grounded and unavailable non-blog drafts;
- redirect satisfied, candidate, stale, conflict, success, and uncertain-result paths;
- selected proposal authorization, reconstruction, dedupe, partial result, idempotence, and bounded request/response behavior;
- UI individual/select-visible/clear/confirm behavior;
- preservation of canonical/indexation and special-surface advisory boundaries;
- preservation of approval, live-gate, exact-target dispatch, locking, receipt, and audit invariants.

Before deployment: focused tests, full tests, both typechecks, lint with zero errors, production build, and diff/invariant inspection must pass. Production verification must prove matching commit/build/PM2/health, refresh the SEO analysis, confirm truthful suppression/candidate counts, and perform no proposal creation or Shopify redirect write during verification.

## Success Criteria

- Existing recipe articles are no longer suppressed by a `/blogs/news/` assumption.
- Supported non-blog tasks become executable only when their drafts are grounded in fresh Shopify state.
- Exact map redirects can enter the established approval and guarded execution lifecycle.
- Operators can create any chosen subset of current content/link candidates as pending proposals in one confirmed action.
- Canonicalization, indexation, homepage, and blog-index execution authority remains unchanged.
- Analysis refresh, deployment, and verification create no proposals and perform no Shopify or Meta mutation.
