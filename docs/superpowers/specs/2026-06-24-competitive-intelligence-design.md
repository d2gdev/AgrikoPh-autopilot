# Competitive Intelligence Layer — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface AI-generated market intelligence from captured competitor data — a Weekly Competitive Brief and a "Steal This Ad" ad rewriter — directly in the Market Intelligence module.

**Architecture:** Two features sharing the same data layer (Market Intelligence DB tables, Shopify products API, brand guidelines). The Brief is generated on page load with a 24h cache stored in the existing `RawSnapshot` model. The Ad rewriter is on-demand with no caching.

**Tech Stack:** Next.js App Router · Prisma · Polaris · DeepSeek/OpenRouter (existing AI client via `lib/ai-client.ts`) · Shopify Admin GraphQL

---

## Global Constraints

- All AI calls use the existing `lib/ai-client.ts` client (DeepSeek/OpenRouter — whichever is configured)
- No new Prisma migrations — store brief in existing `RawSnapshot` model (`source: "competitive_brief"`)
- All new API routes require `requireAppAuth` session auth (not cron secret)
- Polaris components only — no custom CSS frameworks
- TypeScript strict — no `any` types
- English-only AI output

---

## Feature 1: Weekly Competitive Brief

### Data Flow

1. Page load triggers `GET /api/market-intelligence/brief`
2. Route checks `RawSnapshot` for `source = "competitive_brief"` fetched within 24h
3. **Cache hit** → return `payload` immediately
4. **Cache miss** → gather context, call AI, upsert `RawSnapshot`, return result

### Context gathered for AI prompt

| Source | What |
|---|---|
| `CompetitorAd` | Last 7 days: new ads, long-running ads (≥30 days active), creative angles distribution |
| `ShoppingPriceHistory` | Last 7 days: price movements per keyword (delta, pct change, store) |
| `MarketInsight` (open) | Last 7 days: all open insights (type, severity, title, summary) |
| Shopify products | Current our products + prices via `/api/market-intelligence/our-products` (internal fetch) |
| Brand guidelines | Via `getBrandGuidelines()` from `lib/content-pilot/brand-guidelines.ts` |

### AI Output Structure

```ts
interface BriefSections {
  adsActivity: string;        // narrative paragraph on ad activity this week
  pricingMovements: string;   // narrative paragraph on price changes
  opportunities: string;      // observations on gaps/angles competitors aren't covering
  recommendedActions: Array<{
    priority: "high" | "medium" | "low";
    action: string;           // direct, specific action to take
    reason: string;           // why, with data backing it
  }>;
  generatedAt: string;        // ISO timestamp
}
```

The AI is prompted to act as a market analyst writing for a Filipino e-commerce brand. Prices in PHP. Actions are specific and data-backed (e.g. "Your price on 'minoxidil shampoo' is ₱620 vs competitor avg ₱450 — consider a ₱50 reduction or bundle offer").

### API Route

**`GET /api/market-intelligence/brief`**

- Auth: `requireAppAuth`
- Cache check: `prisma.rawSnapshot.findFirst({ where: { source: "competitive_brief" }, orderBy: { fetchedAt: "desc" } })`
- If `fetchedAt` is within 24h → return `{ brief: payload, cached: true, generatedAt }`
- Else → generate, upsert snapshot, return `{ brief: payload, cached: false, generatedAt }`
- Error handling: if AI call fails, return `{ error: "Brief generation failed" }` — UI shows a retry state, never crashes the page

**`POST /api/market-intelligence/brief/refresh`**

- Auth: `requireAppAuth`
- Forces regeneration regardless of cache age (manual "Refresh" click)
- Same logic as GET cache-miss path

### UI

**Position:** A `CompetitiveBrief` card rendered above the 4 tabs on the Market Intelligence page.

**States:**
- **Loading** (first visit / cache miss): Polaris `SkeletonBodyText` with 4 sections, subtle "Generating your brief…" label
- **Loaded**: 4 sections rendered as collapsible `Card` sub-sections
- **Error**: `Banner` with tone `"warning"` and a "Try again" button

**Card layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Competitive Brief          Generated 2h ago · [Refresh] │
├─────────────────────────────────────────────────────────┤
│ Ads Activity      [paragraph]                           │
│ Pricing Movements [paragraph]                           │
│ Opportunities     [paragraph]                           │
│ Recommended Actions                                     │
│   🔴 HIGH   [action] — [reason]                        │
│   🟡 MED    [action] — [reason]                        │
│   🟢 LOW    [action] — [reason]                        │
└─────────────────────────────────────────────────────────┘
```

Recommended Actions rendered as a `List` with priority badges (`Badge` tone: `critical`/`attention`/`info`).

---

## Feature 2: Steal This Ad

### Data Flow

1. User clicks "Steal This Ad" on an `AdCreativeCard`
2. `POST /api/market-intelligence/steal-ad` with `{ adId }`
3. Route fetches ad from DB + brand guidelines
4. AI rewrites ad in Agriko's voice
5. Result shown inline on the card
6. Optional: "Send to Content Pilot" creates a `ContentProposal`

### AI Output Structure

```ts
interface StolenAd {
  headline: string;
  adCopy: string;
  cta: string;
  platform: string;          // e.g. "facebook", "instagram"
  suggestedContentType: string; // e.g. "promotional", "educational"
}
```

### API Routes

**`POST /api/market-intelligence/steal-ad`**

- Auth: `requireAppAuth`
- Body: `{ adId: string }`
- Fetches `CompetitorAd` by id (copy, headline, creative angle, platforms)
- Fetches `getBrandGuidelines()`
- Prompt: act as a copywriter, rewrite this ad for [brand] keeping the same creative angle but using our voice and products
- Returns `StolenAd`
- Error: returns `{ error: string }` — UI shows inline error on the card, never crashes

**`POST /api/market-intelligence/steal-ad/send-to-content-pilot`**

- Auth: `requireAppAuth`
- Body: `{ headline, adCopy, cta, platform, suggestedContentType, sourceAdId }`
- Creates `ContentProposal` with:
  - `title`: headline
  - `body`: adCopy
  - `source`: `"steal_ad"`
  - `status`: `"draft"`
  - `metadata`: `{ cta, platform, sourceAdId }`
- Returns `{ proposalId }` — client redirects to `/content-pilot`

### UI on AdCreativeCard

**Button:** "Steal This Ad" — `Button` variant `plain`, shown below the existing card content. Only shown when the ad has `adCopy` or `headline`.

**States:**
- **Idle**: button visible
- **Loading**: button shows spinner, disabled
- **Result**: highlighted `Box` beneath the card with:
  - Rewritten headline (`Text variant="headingSm"`)
  - Rewritten copy (`Text tone="subdued"`)
  - `InlineStack` with: `Button` "Copy to clipboard" + `Button` tone `"success"` "Send to Content Pilot" + `Button` variant `"plain"` "Dismiss"
- **Error**: inline `Banner` tone `"warning"` with message + "Try again"

**Clipboard:** Uses `navigator.clipboard.writeText(headline + "\n\n" + adCopy)`

---

## File Map

| File | Action |
|---|---|
| `app/api/market-intelligence/brief/route.ts` | New — GET brief (cached) |
| `app/api/market-intelligence/brief/refresh/route.ts` | New — POST force-refresh |
| `app/api/market-intelligence/steal-ad/route.ts` | New — POST generate rewrite |
| `app/api/market-intelligence/steal-ad/send-to-content-pilot/route.ts` | New — POST create proposal |
| `lib/market-intel/generate-brief.ts` | New — data gathering + AI prompt for brief |
| `lib/market-intel/steal-ad.ts` | New — AI prompt for ad rewrite |
| `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx` | Modify — add CompetitiveBrief card above tabs |
| `app/(embedded)/(market-intelligence)/market-intelligence/components.tsx` | Modify — add CompetitiveBrief component + StealAdResult inline UI on AdCreativeCard |

---

## Error Handling

- AI unavailable → both features show a non-blocking warning banner; page still loads normally
- No data (zero ads/prices in last 7 days) → brief still generates with a "not enough data yet" message from the AI
- Shopify fetch fails in brief → brief generates without price comparison section, notes it in the output
- `send-to-content-pilot` fails → inline error on the button, user can retry

---

## Out of Scope

- Email delivery of the brief
- Saving "Steal This Ad" results to DB
- Brief history / versioning
- Scheduling brief generation as a cron job
