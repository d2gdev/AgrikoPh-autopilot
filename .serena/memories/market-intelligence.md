---
name: market-intelligence
description: Market Intelligence — competitor tracking, shopping results, ad library, dashboard filters
metadata:
  type: project
---

# Market Intelligence

## Models

- `Competitor` + `CompetitorSocialPage` — tracked competitors
- `MarketKeyword` — keywords to track
- `KeywordResearchResult` — keyword volume/difficulty data
- `ShoppingResult` + `ShoppingPriceHistory` — price tracking over time
- `CompetitorAd` — Meta ad library competitor ads
- `MarketInsight` — AI-generated insights

## Data fetch jobs

- `fetch-market-intel` (05:30 UTC) — competitor ads, social, shopping prices
- `fetch-keyword-research` (05:45 UTC) — keyword data

## Dashboard (`app/(embedded)/(market-intelligence)/`)

Filters: date range (7/30/90/all), keyword filter (shopping view), competitor filter (ads view). All client-side.
Run profiles: `lib/market-intel/profiles.ts` (caps per run type).
Execution queue: `lib/market-intel/execution-queue.ts`.

## Advisory status

Market Intelligence is **read-only / advisory**. No automated actions taken. UI shows advisory banner.

## Not yet implemented

- MI AI analysis endpoint (competitor/price advisory analysis)
- "Send to Ad Pilot" action from MI dashboard
