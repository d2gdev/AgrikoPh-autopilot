---
name: content-pilot-exact-topical-map-suggestions
description: Restrict Content Pilot suggestions to exact URLs and decisions in the active topical map.
last_updated: 2026-07-18
---

# Content Pilot Exact-Map Suggestions

## Outcome

Content Pilot suggests work only for exact URLs governed by the active topical map. It does not invent topics, titles, or URLs from raw search queries.

## Scope

- Actionable suggestions require an exact active-map target URL and a resolved content decision that explicitly authorizes the proposed create, refresh, or expand action.
- Every suggestion retains the active strategy version, exact rule IDs, target URL, mapped title and intent, and the governing decision.
- Exact mapped targets that remain conditional, evidence-gated, or manually gated may appear as research-only context. They cannot be approved, drafted, or published.
- Unmapped GSC queries remain observational SEO data and do not become Content Pilot proposals.
- Stale-strategy, duplicate, prohibited-content, and contradictory proposals remain excluded.
- Existing approval and Shopify publishing safeguards remain unchanged.

## Implementation Boundary

Filter suggestion candidates before proposal persistence, while retaining the existing approval-time eligibility check as a stale-state safeguard. Update Content Pilot presentation only as needed to distinguish actionable exact-map work from mapped research-only context.

No schema redesign, new content-planning system, topical-map expansion, automatic map revision, or unrelated Content Pilot refactor is included.

## Verification

Focused tests will prove:

1. an exact mapped and authorized action is suggested;
2. an unmapped query creates no Content Pilot proposal;
3. an exact mapped but gated target is research-only and non-actionable;
4. stale, duplicate, and prohibited candidates remain excluded.

Run only the focused Content Pilot and topical-map proposal tests plus typecheck and lint for changed files.
