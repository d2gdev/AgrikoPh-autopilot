# Deployment Guide

## Prerequisites

- PostgreSQL running locally (`localhost:5432`, database `autopilot`, user `autopilot`)
- Shopify store with a private app created (permanent admin access token)
- OpenRouter API key

---

## Environment Variables

Set these in `.env` (copy from `.env.example`).

### Setup Order

1. **Database** — set `DATABASE_URL` to your local PostgreSQL connection string (e.g. `postgresql://autopilot:password@localhost:5432/autopilot`)
2. **Security** — generate `CREDENTIALS_ENCRYPTION_KEY` and `CRON_SECRET` first (needed at startup)
3. **Shopify** — API key, secret, admin token, app URL
4. **AI** — OpenRouter key
5. **Connectors** — Meta, Google, GA4, GSC, Klaviyo (all optional; app degrades gracefully without them)

### Full Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string. e.g. `postgresql://autopilot:password@localhost:5432/autopilot` |
| `CREDENTIALS_ENCRYPTION_KEY` | ✅ | 32-byte hex key for AES-256-GCM (`ApiCredential` encryption). Generate: `openssl rand -hex 32` |
| `CRON_SECRET` | ✅ | Bearer token for cron routes. **Fails closed** — all cron jobs reject if absent. Generate: `openssl rand -hex 32` |
| `SHOPIFY_API_KEY` | ✅ | Shopify app API key used for Admin API token refresh |
| `SHOPIFY_API_SECRET` | ✅ | Shopify app API secret used for Admin API token refresh |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | ✅ | Shopify Admin API access token |
| `SHOPIFY_APP_URL` | ✅ | Public URL of the app (use ngrok tunnel for local dev, e.g. `https://your-tunnel.ngrok.io`) |
| `SHOPIFY_STORE_DOMAIN` | ✅ | e.g. `e56aau-5f.myshopify.com` |
| `NEXT_PUBLIC_SHOPIFY_API_KEY` | ✅ | Same as `SHOPIFY_API_KEY` (exposed to browser for App Bridge) |
| `SCOPES` | ✅ | e.g. `read_orders,read_products,read_analytics` |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key |
| `OPENROUTER_MODEL` | Optional | Defaults to `anthropic/claude-sonnet-4-6` |
| `META_ACCESS_TOKEN` | Optional | Meta Ads user access token |
| `META_AD_ACCOUNT_ID` | Optional | Meta ad account ID (e.g. `act_123456`) |
| `META_PAGE_ID` | Optional | Facebook Page ID for organic posts. Falls back to first page in account. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Optional | Google Ads developer token |
| `GOOGLE_ADS_CUSTOMER_ID` | Optional | Google Ads customer ID |
| `GOOGLE_ADS_CLIENT_ID` | Optional | OAuth client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | Optional | OAuth client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | Optional | OAuth refresh token (see Google Ads OAuth below) |
| `GA4_PROPERTY_ID` | Optional | Google Analytics 4 property ID |
| `GA4_SERVICE_ACCOUNT_JSON_PATH` | Optional | Path to service account JSON file |
| `GA4_SERVICE_ACCOUNT_JSON` | Optional | Service account JSON inline (paste full JSON string) |
| `GSC_SITE_URL` | Optional | e.g. `https://agrikoph.com` |
| `GSC_SERVICE_ACCOUNT_JSON_PATH` | Optional | Path to service account JSON file |
| `GSC_SERVICE_ACCOUNT_JSON` | Optional | Service account JSON inline (paste full JSON string) |
| `KLAVIYO_API_KEY` | Optional | Klaviyo private API key |

---

## Database Setup

```bash
# On first deploy (or after pulling latest migrations)
npx prisma migrate deploy

# Seed default guardrail config
npm run db:seed
```

Run these after first setup or after pulling new migrations.

### Topical-map strategy schema and package operations

The topical-map persistence migration is expand-only. Before applying it to any
environment, take and verify a database backup appropriate to that environment.
Then apply committed migrations with:

```bash
npx prisma migrate deploy
```

Do not use destructive schema rollback for this feature. If a deployed strategy
version must be reverted, an authorized operator changes the audited active
activation pointer to an already validated historical version; that is a
strategy rollback, not a Prisma/schema rollback. The migration remains in
place.

Set `TOPICAL_MAP_STRATEGY_ROOT` only to an absolute server-only directory that
contains the complete hash-bound six-artifact package and its manifest. Package
import and validation are operator-triggered; no topical-map validation cron
exists. Import may persist an immutable local package/validation record, but it
never activates a strategy and never writes to Shopify or Meta. Activation is a
separate, audited operator action and must remain blocked unless the package's
own eligibility and runtime-authorization controls permit it. For the approved
July 12 package, both activation eligibility and runtime activation
authorization are false.

---

## Google Ads OAuth

The Google Ads connector uses OAuth (not a service account). Run the one-time setup script to generate a refresh token:

```bash
node scripts/google-ads-oauth.mjs
```

Follow the browser prompt, then copy the printed refresh token into `GOOGLE_ADS_REFRESH_TOKEN`.

---

## Running the App

```bash
npm run dev   # http://localhost:3000
```

Cron routes are defined in `vercel.json` but can be triggered manually at any time — see `docs/CRON.md`.

All cron functions have a 300s (5 minute) max duration.

---

## Verification Checklist

After deploying:

- [ ] `GET /api/health` returns `{"status":"ok"}`
- [ ] `GET /api/cron/status` with `Authorization: Bearer $CRON_SECRET` returns 200
- [ ] `GET /api/settings` from Shopify admin loads guardrail config (auto-seeded on first call)
- [ ] After first cron run: `GET /api/jobs/status` shows a completed `JobRun`
- [ ] `RawSnapshot` rows appear in the database after `fetch-ads-data` runs
