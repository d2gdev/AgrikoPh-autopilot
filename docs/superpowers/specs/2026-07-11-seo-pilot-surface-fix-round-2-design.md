# SEO Pilot Surface Fix Round 2 Design

**Date:** 2026-07-11
**Status:** Approved by `$surface-fix "SEO Pilot" --fix`

## Goal

Remove the five P2 functional defects found by the 2026-07-11 audit without changing SEO Pilot's permission, publication, guardrail, or deployment boundaries.

## Design

### One active meta rewrite per article

An SEO meta rewrite mutates one Shopify meta-title/meta-description pair. The canonical active proposal key is therefore `seo-fix` plus article handle, regardless of supporting query or issue label. Supporting query and issue data remain in `proposedState` and `sourceData`; they do not create parallel active writes. Existing internal-link destination discrimination and handle-less new-content discrimination remain unchanged.

### Opportunity-first content-gap selection

Programmatic content gaps select eligible ranking queries before applying the analysis bound. Eligible queries rank by impressions, then lowest clicks, then position and query for deterministic ordering. The AI prompt may still use its click-sorted top-query context, but deterministic gap discovery must not inherit that presentation order.

### Actionable refresh results

The refresh poller retains safe terminal diagnostics from the dashboard-refresh job. It extracts step names and statuses from the structured job summary and never displays raw error logs. SEO Pilot reports which refresh steps were partial or failed; successful completion copy remains unchanged.

### Complete GSC provenance

`/api/seo` returns the existing `GscFreshness` structure alongside GA4 freshness for both summary and full views. The client types the field and the Overview displays when raw fallback data is selected, including a concise safe fallback reason. No additional data fetch is introduced.

### Multiple page-health findings

Page Health represents findings as `flags: PageHealthFlag[]`. A compatibility `flag` field remains the highest-severity primary finding during the transition so existing callers do not break. Severity combines all applicable conditions, and the panel renders every returned badge.

## Safety and compatibility

- Embedded authentication and permissions are unchanged.
- No Shopify or Meta mutation is executed by implementation or verification.
- No production database, migration, SSH, or deployment action is permitted.
- Existing Polaris components and responsive table patterns remain in use.
- User-visible diagnostics are derived from structured safe status fields, not raw errors.

## Verification

Each behavior receives a failing regression test before implementation. Final verification includes focused SEO suites, the complete test suite, application and test typechecks, lint, a production build against a disposable local PostgreSQL URL, and `git diff --check`.
