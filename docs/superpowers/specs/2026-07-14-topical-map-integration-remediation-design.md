---
name: topical-map-integration-remediation-design
description: Focused remediation design for Store Pilot queue correctness, review usability, isolated execution, diagnostics, and URL-level outcomes.
last_updated: 2026-07-14
---

# Topical-Map Integration Remediation Design

## Objective

Make the production topical-map integration trustworthy and practical for an operator without expanding Shopify execution authority or rebuilding the pilots.

The remediation fixes four demonstrated problems:

1. duplicated and misleading Store Task inventory;
2. an operator queue that mixes actionable work with hundreds of advisories;
3. a global executor that can process recommendations unrelated to the action just confirmed;
4. weak diagnostics and no URL-level SEO outcome measurement for executed map work.

## Scope

### Included

- Remove existing semantic duplicate topical-map advisories and prevent them from recurring.
- Return truthful task totals with bounded pagination.
- Separate executable tasks from advisory reference material in Store Pilot.
- Add useful filtering and grouped-link review without exposing raw HTML as the primary review format.
- Dispatch one explicitly selected approved recommendation through the existing guarded executor.
- Classify stale observations and changed approved bytes as superseded work rather than connector failures.
- Preserve safe Shopify error diagnostics and durable failure audits.
- Measure executed topical-map URLs with available GSC page data after a seven-day window.

### Explicitly deferred

- Redirect execution.
- Canonical or indexation writes.
- Homepage or blog-index writes.
- Autonomous approval or execution.
- A new workflow engine, event bus, generic queue framework, or separate frontend application.
- Visual redesign outside the Store Pilot task queue.

## Design Principles

- Keep the existing `StoreTask`, `Recommendation`, `execute-approved`, and topical-map strategy boundaries.
- Prefer small query, DTO, and handler extensions over new persistence models.
- Preserve `EXECUTE_APPROVED_LIVE_ENABLED=true` plus approved or override-approved status as mandatory live-write gates.
- Preserve exact proposed-state hashing, active-strategy checks, Shopify before-state validation, target locks, receipts, and reobservation.
- Never convert advisory policy into executable authority during this remediation.

## 1. Queue Correctness

Advisory identity will use a stable semantic key derived from strategy version, package hash, target URL, advisory reason, and sorted rule IDs. Sync will supersede older pending or failed topical-map advisories with the same semantic identity, using the existing dismissed-task and rejected-recommendation audit pattern.

A one-time production-safe cleanup will dismiss, not delete, duplicate pending advisories. For each semantic group, the newest valid row remains pending and older rows become dismissed with a replacement note and audit record. Existing completed tasks, execution receipts, executed recommendations, source evidence, and audit history remain untouched.

## 2. Store Pilot Queue Contract and UX

`GET /api/store-tasks` will accept bounded `page`, `pageSize`, and topical-map execution-class filters. It will return:

```ts
type StoreTaskPage = {
  tasks: StoreTaskListDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};
```

`total` will be a database count using the same filter as the page query. `pageSize` will default to 50 and be capped at 100.

Store Pilot will present two queue views:

- **Actionable:** executable topical-map tasks and non-map operational Store Tasks.
- **Advisory:** non-executable topical-map reference items, grouped by advisory reason.

Status remains a secondary filter within each view. Search will cover task title, target URL, and description. Pagination will use Previous and Next controls; no infinite scrolling or virtualized table is required.

The top summary will show Actionable, Advisory, Applying/Reconciliation, Completed, and Failed. Image metrics remain in the existing image section rather than competing with queue-state metrics.

For grouped internal-link tasks, the confirmation view will render each anchor and destination from `sourceData.links`, plus the target page and link count. Raw body HTML remains available only behind a secondary disclosure for diagnostic review.

## 3. Target-Specific Execution

The execution handler will accept an optional recommendation ID:

```ts
type ExecuteApprovedOptions = {
  liveRequested?: boolean;
  triggeredBy?: string;
  recommendationId?: string;
};
```

When supplied, the handler will query only that approved or override-approved recommendation and process at most one record. When omitted, the existing scheduled batch behavior remains unchanged for Meta and other already-approved work.

The Store Task Apply route will continue to approve and queue without writing Shopify. A separate authenticated, permission-checked Store Task execution route will call the target-specific handler for the linked recommendation. The UI will label these stages accurately:

- **Approve and queue** changes recommendation state only.
- **Execute approved change** runs the existing live-gated dispatcher for that specific recommendation.

The execution route will reject a recommendation that is not linked to the requested Store Task. It will not accept arbitrary action payloads or proposed bytes from the browser.

## 4. Stale Work, Diagnostics, and Reconciliation

`APPROVED_BYTES_CHANGED`, `OBSERVATION_CHANGED`, `STRATEGY_CHANGED`, and `RULE_CHANGED` will finalize the task as `dismissed` with a typed superseded reason and finalize the recommendation as `rejected`. They will not count as connector failures. The UI will direct the operator to Sync topical map, which creates current work through the existing synchronization path.

Actual Shopify transport, mutation, or verification failures will remain failed or reconciliation-needed states. Safe diagnostics will retain:

- the typed failure code;
- Shopify user-error message when available;
- whether a mutation request was sent;
- whether reobservation found the expected state;
- the job-run ID.

Every terminal execution path will await a durable audit write. Raw credentials, tokens, GraphQL variables, full HTML bodies, and database schema details will never be persisted in error text.

## 5. URL-Level SEO Outcomes

The existing generic recommendation outcome job will route `apply_topical_map_store_task` recommendations to a topical-map outcome evaluator. After at least seven days, it will compare GSC page metrics for the receipt's `targetUrl` across equal before and after windows.

The outcome payload will record clicks, impressions, CTR, and average position when available. If either window lacks page data, the verdict is `insufficient_data` with a typed reason. Revenue remains advisory context and does not determine the SEO verdict.

No new analytics provider or attribution model is introduced.

## Error Handling

- Invalid pagination or filters return `400` without querying tasks.
- A missing or no-longer-pending task returns `409` through existing typed errors.
- A target-specific execution request returns a bounded result for exactly one recommendation.
- Sync cleanup is transactional per semantic duplicate group and safe to rerun.
- Failed audit persistence makes the execution job fail rather than silently losing evidence.
- Outcome evaluation never blocks execution or changes Shopify state.

## Testing Strategy

1. Unit tests for stable advisory semantic identity and duplicate selection.
2. Route tests proving accurate counts, bounded pagination, filters, authentication-first behavior, and DTO limits.
3. Component tests for actionable/advisory separation, grouped-link summaries, pagination, empty states, and typed stale messaging.
4. Executor tests proving a supplied recommendation ID cannot process any other approved record.
5. Execution tests for superseded versus genuine connector-failure classification and awaited audits.
6. Outcome tests for URL-level GSC before/after windows and insufficient-data behavior.
7. A production-safe cleanup dry run that reports groups and affected counts before the separately authorized write run.

## Acceptance Criteria

- Production has one pending advisory per semantic key and zero semantic duplicates.
- Store Pilot totals equal database counts and pagination exposes all matching records.
- Actionable work is visually and query-wise separate from advisory reference material.
- Grouped internal-link confirmation lists every anchor and destination.
- Executing a selected Store Task cannot execute another approved recommendation.
- Stale strategy, observation, rule, or approved-byte conflicts do not appear as Shopify connector failures.
- Every genuine failure or reconciliation state has a durable, safe audit record.
- Executed topical-map recommendations receive URL-level GSC outcomes or an explicit insufficient-data reason.
- Existing approval, permission, live gate, strategy, hash, target-lock, receipt, and reobservation protections remain intact.

