# Market Intelligence Page Redesign — Design

**Date:** 2026-06-22
**Scope:** Presentational refactor of `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`. No API, schema, or data-model changes. The `GET /api/market-intelligence` payload stays exactly as-is.

## Problem

The current page is confusing because:

1. **Setup is in the way.** The "Track Shopping Keyword" and "Track Meta Competitor" config forms sit near the top, above the actual intelligence. They are used rarely but seen every visit.
2. **Four flat tables, no hierarchy.** Insights, Google Shopping, Keyword Research, and Meta Ads all render as equally-weighted dense `DataTable`s. Nothing signals what matters or what to do.
3. **The headline is buried.** "Insights" — the *so-what* — is just another table among four, not the first thing seen.
4. **Ad creative as table rows.** Competitor headline/ad-copy crammed into a row is hard to read; creative belongs in a card.

## Goals

- Lead with the *so-what* (insights), not setup.
- Give the page a clear top-to-bottom narrative organized around its stated promise: competitor ad creative, shopping visibility, pricing movement.
- Separate **viewing controls** (filters — kept visible) from **setup** (add keyword/competitor — moved out of the daily view).
- Improve empty and loading states so each section guides the user.

Non-goals: changing what data is captured, adding new metrics/trends that require backend work, or touching other pilots.

## New layout (top to bottom)

1. **Page header** — unchanged. Title "Market Intelligence", subtitle, primary action "Run capture", secondary "Keyword research".
2. **Error / success banners** — unchanged behavior.
3. **Stat cards (4)** — Active Competitors, Tracked Keywords, Open Insights, Last Capture. Improve "Last Capture" to show a relative time ("2h ago") plus a status `Badge` (success/critical/attention) instead of a bare status string.
4. **Filter bar** — compact card with the existing three controls (Date range, Keyword (shopping), Competitor (ads)). These are *viewing* controls and stay near the data. Render as a single slim `InlineStack`, not a tall card.
5. **Insights — "What changed"** — the headline. Render insights as a vertical stack of **insight cards** (not a table), sorted by severity (critical → warning → info → success), then newest first. Each card:
   - severity `Badge` (tone via existing `severityTone`)
   - title (`headingSm`)
   - summary text
   - footer line: source (competitor name or keyword) · relative captured time · status
   - Empty state: "No insights yet — run a capture to analyze competitor moves."
6. **Shopping visibility & pricing** — section heading + one-line helper subtitle. Keep the existing `DataTable` (Keyword, Product, Store, Price, Position, Captured) — this data is genuinely comparative/tabular. Honors the keyword + date filters as today. Improved empty state.
7. **Competitor ad creative** — section heading + helper subtitle. Render Meta ads as a **responsive grid of creative cards** instead of table rows. Each card:
   - competitor name (`Badge`) + active-status `Badge`
   - headline (bold) — falls back to ad copy / "No ad text"
   - ad copy (truncated, ~160 chars)
   - footer: started date · captured (relative)
   - Honors the competitor + date filters as today. Improved empty state.
8. **Keyword research (collapsible)** — a `Button`-toggled `Collapsible` "Keyword research details" containing the existing `DataTable` (Keyword, Monthly Searches, Competition, Index, Low Bid, High Bid, Captured). Collapsed by default when other sections have data; this is the most reference-y dataset. No filtering (matches current behavior).
9. **Manage tracking (collapsible)** — a `Button`-toggled `Collapsible` "Manage tracking" at the bottom holding the two config forms (Track Shopping Keyword, Track Meta Competitor). Collapsed by default. All existing form state, validation, and save handlers are preserved verbatim.

## Components

To keep the file focused, extract two small presentational components co-located in the page file (or as sibling files under the route folder if cleaner):

- `InsightCard({ insight })` — renders one insight card from a `MarketInsight`.
- `AdCreativeCard({ ad })` — renders one competitor-ad creative card from a `CompetitorAd`.

Both are pure, prop-driven, and depend only on Polaris + the existing helper functions. Everything else (data fetching, filters, form handlers, `useMemo` row builders that survive) stays in `MarketIntelligencePage`.

## Helpers

- Add `relativeTime(value?: string | null): string` — "just now", "2h ago", "3d ago", falling back to `shortDate` for older/absent values.
- Keep `shortDate`, `severityTone`, `money`, `readJson`.
- Add a severity rank map for sorting insights.

## Data flow

Unchanged. `load()` fetches `GET /api/market-intelligence` into `MarketData`. The existing `useMemo` filter logic for shopping (`shoppingRows`) and ads (`adRows`) is reused, but ads map to card props instead of table rows; insights map to card props instead of `insightRows`. `keywordResearchRows` stays as the table source.

## Error handling

Unchanged — the resilient `readJson()` + banner approach from the prior fix stays. Collapsible toggles are local UI state with no failure modes.

## Testing

Manual verification (no test harness exists for these embedded pages):
- Page compiles (`rtk tsc --noEmit`).
- With data present: insights show as severity-sorted cards; shopping table populated; ad cards render; keyword research and manage sections expand/collapse.
- With no data: each section shows its guidance empty state; "Manage tracking" can be opened to add the first keyword/competitor.
- Filters still narrow shopping (by keyword/date) and ads (by competitor/date).
- Deploy to Linode and confirm `HTTP 200` + visual check.

## Risks / trade-offs

- Larger diff to one file than the "lighter reorder" alternative, but no behavioral/data risk since it is presentational and reuses existing handlers.
- Collapsing keyword research by default hides it one click deeper — acceptable as it is reference data, and it remains discoverable.
