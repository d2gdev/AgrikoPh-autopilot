# Market Intelligence Tabs — Design Spec

**Date:** 2026-06-23  
**Module:** Market Intelligence  
**Status:** Approved

---

## Goal

Restructure the Market Intelligence page from a single long scrolling page into a tabbed layout using Polaris `Tabs`. Four tabs — Insights, Ads, Shopping, Keywords — replace the stacked `Layout.Section` approach. Stat cards, date range filter, and the "Manage tracking" collapsible remain permanently visible outside the tab body.

---

## Architecture

Single file change: `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`

No new files. No routing changes. No API changes. Add Polaris `Tabs` import, one `selectedTab: number` state, and conditionally render each tab's content block.

---

## Layout Structure

```
Page header (title, Run capture, Keyword research buttons)
  └── Banners (error / notice)
  └── Stat cards
  └── Date range filter   ← global, always visible
  └── [Tabs: Insights | Ads | Shopping | Keywords]
        └── [Tab body — conditional on selectedTab]
  └── Manage tracking (collapsible)   ← always visible below tabs
```

---

## Tab Definitions

### Tab 1 — Insights
- Content: "What changed" heading + insight cards (existing `sortedInsights` render)
- No tab-specific filter

### Tab 2 — Ads
- Tab-specific filter: "Filter ads by competitor" `TextField` — moves from the global filter bar into this tab's header area
- Content: Angle badges + competitor ad creative grid (existing `adCards` render)

### Tab 3 — Shopping
- Tab-specific filter: "Filter shopping by keyword" `TextField` — moves from the global filter bar into this tab's header area
- Content (stacked):
  1. Shopping visibility & pricing `DataTable` (existing `shoppingRows` render)
  2. Price comparison cards (existing `priceComparisons` render)

### Tab 4 — Keywords
- Content: Keyword research `DataTable` (existing `keywordResearchRows` render)
- Remove the `Collapsible` wrapper — the tab itself provides the show/hide

---

## Global Filter Bar Changes

**Before:** Three controls — Date range, Filter shopping by keyword, Filter ads by competitor  
**After:** One control — Date range only

The two text filters relocate into their respective tab content areas.

---

## "Manage Tracking" Section

Remains as a persistent `Layout.Section` below the tab panel. No changes to its content (Track Shopping Keyword + Track Meta Competitor forms). The collapsible wrapper stays — it is infrequently used setup.

---

## Bug Fix (included in this change)

`adCards` useMemo dependency array still references `longRunCutoff` after that variable was removed. Remove `longRunCutoff` from the dependency array:

```ts
// Before
}, [data?.competitorAds, cutoff, filterCompetitor, longRunCutoff]);

// After
}, [data?.competitorAds, cutoff, filterCompetitor]);
```

---

## State Changes

| New state | Type | Purpose |
|-----------|------|---------|
| `selectedTab` | `number` | Tracks active tab index (0–3), defaults to `0` |

No state removed. `filterKeyword` and `filterCompetitor` remain — they just render in different locations.

---

## Polaris Components

- Add `Tabs` to the `@shopify/polaris` import
- `Tabs` props: `tabs` array of `{ id, content }`, `selected={selectedTab}`, `onSelect={setSelectedTab}`
- Tab body wrapped in a `<div>` or `Layout.Section` inside the `Tabs` component's children

---

## Out of Scope

- Persisting selected tab to URL params or localStorage
- Extracting tab content into separate component files
- Any changes to data fetching, API routes, or Prisma schema
