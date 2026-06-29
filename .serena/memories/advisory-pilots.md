---
name: advisory-pilots
description: SEO, Email, Social, Store pilots — advisory only, no automated actions
metadata:
  type: project
---

# Advisory Pilots

The following pilots are **read-only / advisory**. They surface insights and suggestions but take no automated actions. Each shows a blue "Advisory — read-only" banner in the UI.

| Pilot | Page | What it shows |
|-------|------|---------------|
| SEO Pilot | `(seo-pillar)/` | Keyword rankings, GSC data, content gaps |
| Email Pilot | `(email-pilot)/` | Klaviyo metrics, list health, send suggestions |
| Social Pilot | `(social-pilot)/` | Organic post performance, reach trends |
| Store Pilot | `(store-pilot)/` | Product image alt-text suggestions |

## Store Pilot

Alt-text suggestions are generated but NOT written back to Shopify automatically. Write-back not yet implemented (Phase 8 open item).

## GSC 403 known issue

`fetch-seo-data` fails because service account `analytics-ga-4@gen-lang-client-0853027342.iam.gserviceaccount.com` hasn't been granted access to the Search Console property `agrikoph.com`. Fix: add that email in Google Search Console.
