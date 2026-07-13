---
title: SEO Pilot Topical Map Command Center Design
status: approved
last_updated: 2026-07-13
---

# SEO Pilot Topical Map Command Center

## Outcome

SEO Pilot becomes the operator-facing command center for the active topical map. The active, validated strategy package is the only strategy authority shown or used by the surface. The hardcoded June 2026 keyword strategy, legacy strategy copy, and stale analysis derived from an earlier strategy disappear completely from the live UI.

The redesign must maximize use of the map without making execution autonomous. It turns map rules and current store/search evidence into traceable findings and operator-controlled proposals. Existing live-execution authorization and approval guardrails remain unchanged.

## Product decisions

- Remove the June strategy completely rather than retaining an archive view.
- Use all eleven compiled rule domains, not only clusters and keywords.
- Keep raw observations distinct from governed actions.
- Require every map-derived action to identify its strategy version and applicable rule or rules.
- Invalidate derived analysis when the active strategy identity changes.
- Never synthesize a fallback strategy when there is no active valid map.
- Keep execution operator-controlled: the dashboard may create proposals, but publication or live changes still require the existing approval and live-execution gates.

## Alternatives considered

### Replace only the Strategy tab

This is the smallest change, but it underuses the map and leaves Content Gaps, Opportunities, and actions operating from unrelated logic. Rejected.

### Add a separate Topical Map tab

This preserves the existing surface but creates two competing strategy systems. It would make the map informational rather than operational. Rejected.

### Make the active map the SEO Pilot operating model

All SEO Pilot views use the same active strategy identity, expose the applicable parts of the complete rule set, and create governed proposals. Selected.

## Strategy authority and data flow

The active `TopicalMapStrategyVersion` and its immutable compiled rules are the sole strategy source. A server-side projection layer converts those rules into bounded, UI-safe view models. Client components do not parse raw artifacts and do not import static keyword-strategy constants.

Current Shopify, Search Console, and audit data remain observations. The application joins those observations to the active map projection to identify implementation state, gaps, conflicts, and candidates. The compliance evaluator remains authoritative when a candidate becomes a proposal.

Each response derived from the map includes:

- strategy version ID, strategy date, contract revision, and package hash;
- rule IDs and source references needed for traceability;
- an `asOf` timestamp for mutable observations;
- explicit states for unavailable data, not-yet-run analysis, and stale analysis.

No endpoint returns raw package contents merely for presentation. Projection endpoints expose only the fields required by the surface.

## Complete map utilization

The command center must represent every compiled rule domain:

| Domain | Operator use |
| --- | --- |
| `clusters` | Cluster coverage, member pages, and implementation progress |
| `page_roles` | The intended job and page type of each governed URL |
| `url_intent_ownership` | Exclusive query/intent ownership and cannibalization checks |
| `content_decisions` | Create, improve, preserve, consolidate, or retire decisions |
| `prohibited_content` | Suppressed candidates and an explanation of why they cannot become actions |
| `internal_links` | Missing links, recommended anchors, purpose, priority, and verification state |
| `redirects` | Required redirect changes and observed conformance |
| `canonicalization` | Canonical findings and proposals, subject to existing execution prohibition |
| `indexation` | Indexation findings and proposals, subject to existing execution prohibition |
| `evidence_gates` | Evidence still required before an action can progress |
| `high_stakes_reviews` | Explicit review requirements and blocked-state explanations |

## Information architecture

### Map overview

The entry view answers: which map is active, how much is implemented, what is blocked, and what deserves attention next. It shows cluster coverage, page-decision distribution, priority action totals, evidence/review blockers, and implementation progress by action family.

### Pages and ownership

A page-centric workspace shows each governed URL's cluster, page role, primary theme, variants, dominant intent, exclusive ownership scope, content decision, priority, and current implementation state. It highlights unmapped live pages, missing mapped pages, and ownership conflicts without converting those observations directly into executable changes.

### Content gaps

Content gaps are the difference between map requirements and current verified site/search state. They are not generic AI suggestions. Results identify the missing or deficient requirement, supporting evidence, applicable map rules, priority, and permitted next action.

### Links and technical work

Dedicated queues expose internal-link, redirect, canonical, and indexation requirements. Canonical and indexation items remain visible and proposal-capable where supported, but their live execution remains prohibited by the active contract. The interface must explain this state rather than hiding the work.

### Governed action queue

The action queue unifies eligible content, link, redirect, and technical candidates. Every candidate displays provenance, evidence readiness, review requirements, proposal state, and execution state. Actions include only transitions permitted by the current lifecycle and guardrails.

## Lifecycle and progress

Map work uses an explicit progression:

`required -> observed -> candidate -> proposed -> approved -> executed -> verified`

An item can instead be `blocked`, `not_applicable`, or `superseded`, with a reason. The UI derives progress from persisted proposals, recommendations, tasks, audits, and observed site state; it must not equate rendering a map rule with completing it.

Repeated proposal creation remains idempotent. Existing proposal deduplication and compliance evaluation are reused rather than reimplemented in the client.

## Analysis freshness

All stored or cached SEO analysis must carry the active strategy version ID and package hash. An analysis is usable only when both match the current active strategy and its observation freshness remains valid.

When activation changes:

- older analysis disappears from active results immediately;
- the UI shows that analysis is required for the new map;
- old results cannot seed cards, counts, recommendations, or proposals;
- rerunning analysis uses the new map projection.

## Removal of the June strategy

The implementation removes every live import and presentation of the hardcoded June keyword strategy, including targets, secondary banks, clusters, roadmap copy, and report attribution. Any obsolete module with no remaining legitimate use is deleted. Tests must fail if June strategy copy or constants reappear on the SEO Pilot surface.

No fallback may silently substitute these values when map loading fails. The correct failure state is an authenticated, actionable “no active strategy” or “strategy unavailable” state.

## Interaction and visual design

The interface prioritizes operational clarity over a wall of cards:

- one clear strategy identity and health band at the top;
- dense, filterable tables or grouped worklists for repeated rule data;
- progressive disclosure for evidence and source provenance;
- persistent filters for cluster, priority, rule family, implementation state, and blocker;
- responsive layouts without horizontal page overflow;
- accessible labels, keyboard operation, focus states, and non-color status cues;
- destructive or live-impacting actions clearly differentiated from proposal creation.

Empty states distinguish no active map, no analysis, no findings, stale findings, and upstream data failure.

## Security and control boundaries

- Embedded API routes call `await requireAppAuth(req)` first.
- Database access uses the shared Prisma client.
- Projection endpoints never expose unrestricted artifact bytes.
- Proposal creation passes through existing normalization, compliance, and persistence paths.
- Live Shopify changes require approved status and `EXECUTE_APPROVED_LIVE_ENABLED=true`.
- Topical-map activation authorization remains separate from live execution authorization.
- `pause_ad` guardrail behavior is unaffected.

## Verification and acceptance gates

Implementation is acceptable only when:

1. No SEO Pilot runtime component imports or renders the June strategy.
2. The active strategy identity displayed in SEO Pilot matches the database-active package.
3. All eleven rule domains have an intentional UI or workflow representation.
4. Page ownership, content decisions, link requirements, and technical requirements are derived from compiled rules.
5. Content gaps combine map requirements with current observations and include provenance.
6. Every created proposal is evaluated against the active map and persists strategy/rule context.
7. Changing the active package makes prior analysis unavailable without manual cache clearing.
8. No-map, stale, loading, failure, and genuinely empty states are distinguishable.
9. Canonical/indexation live execution remains prohibited while their required work is visible.
10. Existing authentication, approval, idempotency, and live-execution tests continue to pass.
11. New server, component, integration, accessibility, and responsive tests cover the redesigned workflows.
12. Production verification confirms the deployed commit, build artifact, PM2 process, public health endpoint, active strategy identity, and absence of June strategy content.

## Documentation and operational record

Implementation updates `.mex/ROUTER.md`, relevant topical-map and SEO Pilot context, and recurring-operation runbooks. Deployment and any production data operation remain separately evidenced and recorded under the project's GROW requirements.
