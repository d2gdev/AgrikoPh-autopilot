# Price Comparison Tab — Design Spec

**Date:** 2026-06-23  
**Module:** Market Intelligence  
**Status:** Approved

---

## Goal

Add a "Price comparison" tab to the Market Intelligence page that shows each of our Shopify products alongside the closest matching competitor products (from captured shopping results), with a badge indicating whether we are priced above or below the market average for that product.

---

## Data Sources

### Our products
- **Source:** Shopify Admin GraphQL API
- **New route:** `GET /api/market-intelligence/our-products`
- **Query:** `products(first: 100)` → `title`, `cheapest variant price`, `currency`
- **Caching:** Response cached in React state for the session (no re-fetch on tab switch)

### Competitor prices
- **Source:** `shoppingResults` already returned by the existing `GET /api/market-intelligence` endpoint
- **Fields used:** `title`, `titleEn`, `price`, `currency`, `store`, `capturedAt`
- No schema changes required.

---

## Matching Algorithm (client-side)

For each of our products, score every shopping result by **normalised word-overlap**:

1. Tokenise both titles (lowercase, strip punctuation, remove common stop words: "the", "a", "and", "of", "for", "with", "kg", "g", "ml", "l", "pack", "set", "pcs")
2. Score = `|shared tokens| / |union of tokens|` (Jaccard similarity)
3. Keep results with score ≥ 0.25 as "comparable", cap at top 5
4. If no result scores above threshold → show "No comparable products found in current data range"

Use `titleEn` when available (translated), fall back to `title`.

---

## Market Average Badge

From the matched competitor results (those above threshold):
- Compute `marketAvg = mean(competitor prices)` — skip nulls
- Compare our price:
  - `our price < marketAvg × 0.97` → **Below avg** (green badge)
  - `our price > marketAvg × 1.03` → **Above avg** (red badge)
  - Otherwise → **At market** (neutral badge)
- 3% band avoids flickering badge for trivially similar prices

---

## UI

### Tab
New "Price comparison" tab added to the Market Intelligence page alongside existing tabs (Insights, Shopping results, Competitor ads, Keywords).

### Card layout (one card per our product)
```
┌─────────────────────────────────────────────┐
│ Agriko Cinema Popcorn 1kg                   │
│ Our price: PHP 299          [Below avg ↓]   │
├─────────────────────────────────────────────┤
│ 🏪 Lazada     Cinema Popcorn 1L    PHP 350  │
│ 🏪 Shopee     Popcorn Tub 1kg      PHP 320  │
│ 🏪 MetroMart  Cinema Snack 1kg     PHP 380  │
│                                             │
│ Matched by title similarity                 │
└─────────────────────────────────────────────┘
```

- Competitor rows sorted cheapest-first
- Store name + competitor product title shown so user can judge match quality
- "Matched by title similarity" label in subdued text at card bottom
- Cards displayed in a responsive grid (same as ad creative cards)

### Empty states
- **No Shopify products loaded:** "Could not load your products. Check your Shopify credentials in Settings."
- **No shopping results in range:** "No competitor pricing data for this date range."
- **No match for a specific product:** Card still shown, body says "No comparable products found in current data range."

### Loading
- Spinner while `our-products` fetch is in-flight; shopping results already loaded by parent

---

## New Files / Changes

| File | Change |
|------|--------|
| `app/api/market-intelligence/our-products/route.ts` | New — fetch Shopify products + prices |
| `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx` | Add tab + tab content |
| `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` | Add `PriceComparisonCard` component |

No schema changes. No new dependencies.

---

## Out of Scope

- Manual keyword→product mapping (future enhancement)
- Persisting matches to the database
- Price history trend for competitor matches (future enhancement)
