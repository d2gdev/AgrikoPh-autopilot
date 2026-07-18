# Content Pilot Current and Future Map Work

Date: 2026-07-18
Status: approved

## Goal

Make Content Pilot useful as a current and forward work surface without widening the active topical map or authorizing future work early.

## Scope

The Brief tab will show:

1. **Available now** — exact active-map content candidates backed by a current, strategy-matched SEO analysis. Existing brief and queue actions remain unchanged.
2. **Upcoming mapped phases** — open future `SeoFollowUpTask` phase records for the exact active strategy, ordered by review date. The UI shows the persisted phase title, dates, and obligation text verbatim. These rows are read-only.
3. **Mapped research only** — the existing exact mapped suppressions when a current analysis is available.

No topic, URL, obligation, classification, or date may be inferred or generated for the roadmap.

## Data Flow

`GET /api/content-pilot/map-suggestions` remains authenticated and loads the active topical-map command center first.

- It reads open `topical_map` phase tasks whose persisted `sourceData.strategyVersionId` and `sourceData.packageSha256` match the active strategy.
- It returns only future phase records, bounded to the existing rolling 90-day schedule.
- It attempts to read the latest strategy-bound SEO analysis for current candidates and research suppressions.
- If analysis is missing, stale, or belongs to another strategy, the endpoint still returns the future roadmap and an explicit current-work status. It returns no current action or research candidates.
- Existing brief and promotion endpoints continue to revalidate the current strategy and candidate identity before mutation.

## UI

The Brief tab uses three clearly separated cards:

- **Available now**
- **Upcoming mapped phases**
- **Mapped research only**

Upcoming rows show their review window and exact stored obligations. They have no brief, queue, publish, or mutation controls. A stale-analysis banner explains that current work requires an SEO refresh without hiding future work.

## Failure and Safety Rules

- Active topical-map data remains required. If it is unavailable, the endpoint fails closed.
- A stale or mismatched analysis disables current actions but does not suppress the future roadmap.
- A future task with missing or mismatched strategy identity is excluded.
- The roadmap is read-only and does not create, edit, complete, or promote tasks.
- No Shopify or Meta write path changes.

## Verification

Focused tests will cover:

- authentication remains the first route operation;
- current exact-map candidates still load when analysis is current;
- stale or mismatched analysis returns no current candidates but does return matching future phases;
- tasks from another strategy are excluded;
- future phase rows render dates and obligations without action buttons;
- existing current brief and queue actions remain available only for current candidates.
