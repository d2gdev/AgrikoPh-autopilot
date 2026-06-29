---
name: connectors
description: External API connectors — Meta, Shopify, Google, SEO, market intel
metadata:
  type: project
---

# Connectors (`lib/connectors/`)

## Meta

- `meta.ts` — Meta Marketing API calls (campaigns, ad sets, ads)
- `meta-organic.ts` — Facebook page organic post data
- `meta-token.ts` — token validation and expiry check
- Token: `META_ACCESS_TOKEN` (manual rotation; warn 30d before expiry via `META_TOKEN_EXPIRES_AT`)
- Ad account: `META_AD_ACCOUNT_ID`

## Shopify

- `lib/shopify-admin.ts` — GraphQL client with auto-refresh on 401
- `lib/shopify.ts` — App Bridge / session-based client
- `lib/connectors/shopify-token.ts` — `refreshAndStoreShopifyToken()` (see `mem:credentials`)
- Reads blog articles, products, images

## Google

- `connectors/ga4.ts` — GA4 data API (sessions, conversions, revenue)
- `connectors/gsc.ts` — Google Search Console (impressions, clicks, position)
- `connectors/google-ads.ts` — Google Ads performance
- Auth: service account `analytics-ga-4@gen-lang-client-0853027342.iam.gserviceaccount.com`
- **Known issue**: GSC 403 — service account not added to Search Console property for `agrikoph.com`

## SEO / Market Intel

- `connectors/dataforseo-shopping.ts` — shopping results
- `connectors/serper-shopping.ts` — Google Shopping scrape
- `connectors/meta-ad-library.ts` — competitor ad analysis
- `connectors/meta-ad-library-scraper.ts` — fallback scraper
- `connectors/klaviyo.ts` — email metrics

## Connector health

`lib/config/connector-health.ts` — returns live status per connector. Shows dynamic notes (Meta token expiry, Shopify refresh status). Called by Settings → Connectors.
