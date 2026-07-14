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
| `GOOGLE_MERCHANT_ID` | Optional | Google Merchant Center account ID |
| `GOOGLE_MERCHANT_ACCOUNT_JSON` | Optional | Relative path to Google Merchant service account JSON file |
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

## Topical-map command-center deployment preparation (2026-07-13)

Status: **deployed and verified on 2026-07-13**. The required whole-branch review passed with no Critical or Important findings before deployment. `node scripts/git-deploy.mjs` deployed reviewed `main`; no environment authorization flag, strategy activation, production data, Shopify object, or Meta object was changed as part of the release.

Fresh local evidence from branch `feat/seo-pilot-topical-map-command-center`:

- Focused Task 7 gate: 8 files passed, 97 tests passed.
- Full suite: 197 files passed and 3 skipped; 1,358 tests passed and 8 skipped.
- ESLint: exit 0 with zero errors and 87 existing warnings.
- Build: exit 0 with `DATABASE_URL` restricted to local `autopilot_test` plus `connection_limit=10&pool_timeout=10`; `/api/topical-map/command-center` and `/seo-pillar` were emitted.
- `git diff --check`: exit 0.
- Read-only/auth workflow coverage: auth precedes Prisma; ready response identity matches the active projection; all eleven domains are returned; source bytes are excluded; five operator jobs remain reachable; stale analysis is withheld; exact mapped content/link proposals persist rule/strategy context; stale, unrelated, or altered contexts fail closed; canonical/indexation advertise no live execution.
- Legacy proof: recursive runtime-source regression checks exclude the June report string, `KEYWORD_CLUSTERS`, `PRIMARY_TARGETS`, `SECONDARY_BANK`, `ROADMAP`, `keyword-strategy`, retired panels/handlers, and hidden tabs 5–8.

After whole-branch review, deploy only the reviewed main commit through `node scripts/git-deploy.mjs`. Do not change `EXECUTE_APPROVED_LIVE_ENABLED`, `TOPICAL_MAP_ACTIVATION_ENABLED`, database data, or strategy activation as part of this UI release. Fresh production acceptance must record:

- [x] reviewed local/main/origin commit and `/opt/autopilot` `HEAD` matched `1655651353135a51b8ca04320af6f0385f9e7e6d` for the runtime deployment;
- [x] active build ID `iOjJUEzO5VD2twnzveFnB` existed with artifact time `2026-07-13T05:41:53Z`;
- [x] PM2 `autopilot` restarted at `2026-07-13T05:42:22.330Z`, after the build, and reported `online`;
- [x] public health returned `{"status":"ok","degradedReasons":[]}` at `2026-07-13T05:45:11Z`;
- [x] authenticated command-center API returned `ready`, active version `cmriak0gt00y8s66lxrfkstp6`, package `f2a39fabd27a1dcb7ffb29e44695d18a39325186443137dd15762126a8d1bf1c`, and all eleven domain counts;
- [x] the deployed client bundle contained exactly the five job labels and the remote runtime/bundle scan contained no June strategy module, constants, or report copy; direct HTML rendering correctly redirected to Shopify authentication and therefore was not falsely claimed as a browser-session visual check;
- [x] authenticated SEO analysis returned `empty` with the active version and no cached strategy or stale analysis content;
- [x] canonical/indexation remained explicitly non-executable; database verification found zero new `Recommendation` and zero new `ContentProposal` rows since the build timestamp;
- [x] deployment evidence recorded server commit, build identity/time, PM2 restart time, health response, active map identity, legacy-content absence, and no-live-write observation.
