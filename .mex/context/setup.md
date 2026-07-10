---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/architecture.md
    condition: when understanding how components connect during setup
  - target: context/decisions.md
    condition: when understanding why deployment is structured a particular way
last_updated: 2026-07-10T20:33:00Z
---

# Setup

## Prerequisites

- Node.js 20+
- PostgreSQL (local instance or remote; connection string in `DATABASE_URL`)
- npm (not pnpm or yarn — this project uses npm)
- ngrok (for local Shopify embedding — the app must be served over HTTPS)

## First-time Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the required values (see below)
3. `npm run db:generate` — generates the Prisma client from `prisma/schema.prisma`
   and writes its freshness stamp; run `npm run verify:prisma-client` before typechecking
   when dependencies or the Prisma schema changed.
4. `npm run db:migrate` — deploys all pending migrations against your `DATABASE_URL`
5. For Shopify embedding: start ngrok (`ngrok http 3000`), set `SHOPIFY_APP_URL` to the HTTPS forwarding URL
6. `npm run dev` — starts the dev server on port 3000

## Environment Variables

**Required (app won't start without these):**
- `SHOPIFY_API_KEY` — Shopify app client ID
- `SHOPIFY_API_SECRET` — Shopify app client secret
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — private app admin token for blog/product writes
- `SHOPIFY_STORE_DOMAIN` — e.g. `e56aau-5f.myshopify.com`
- `SHOPIFY_APP_URL` — must be an HTTPS URL (ngrok in dev, real domain in prod)
- `OPENROUTER_API_KEY` — AI fallback; also used by legacy direct-analysis routes
- `DATABASE_URL` — PostgreSQL connection string; include `?connection_limit=10&pool_timeout=10` in prod
- `CRON_SECRET` — Bearer token for cron routes; fails closed if unset in production
- `CREDENTIALS_ENCRYPTION_KEY` — 32-byte hex key for encrypting stored credentials; generate: `openssl rand -hex 32`

**Required for AI skills:**
- `DEEPSEEK_API_KEY` — primary AI provider
- `DEEPSEEK_MODEL` — defaults to `deepseek-v4-flash`

**Required for data connectors:**
- `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` — Meta Ads data fetch and execution
- `GA4_PROPERTY_ID` + `GA4_SERVICE_ACCOUNT_JSON` (or `_JSON_PATH`) — Google Analytics
- `GSC_SITE_URL` + `GSC_SERVICE_ACCOUNT_JSON` (or `_JSON_PATH`) — Search Console
- `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_CUSTOMER_ID` + OAuth creds — keyword research

**Required for market intelligence:**
- `SERPER_API_KEY` — Google Shopping intelligence (primary)

**Conditional:**
- `EXECUTE_APPROVED_LIVE_ENABLED=true` — opt-in for live recommendation execution; keep `false` in dev
- `SCRAPER_DB_PATH` — absolute path to competitor scraper SQLite DB; leave blank if not present locally
- `ALERT_WEBHOOK_URL` — POST target for job failure alerts; optional

**Optional aliases:**
- `DATABASE_URL_PROD` — accepted when `DATABASE_URL` is unset (useful in some deployment setups)

## Common Commands

- `npm run dev` — dev server on port 3000 (uses `node server.js`)
- `npm test` — run full vitest suite
- `npm run test:watch` — vitest in watch mode
- `npm run typecheck:test` — TypeScript check on test files
- `npm run db:migrate` — deploy pending Prisma migrations
- `npm run db:generate` — regenerate Prisma client after schema changes
- `npm run verify:prisma-client` — fail if the generated Prisma client stamp does not match
  `prisma/schema.prisma`, `package.json`, and `package-lock.json`
- `DATABASE_URL_TEST='postgresql://test:test@127.0.0.1:5432/autopilot_test' npm run test:postgres`
  — run PostgreSQL integration tests only against the exact local `autopilot_test` database.
  The guard rejects missing URLs, every non-local host, and every URL-decoded database path
  other than `autopilot_test`.
  CI may use its `postgres` service host only with `CI=true` and `ALLOW_CI_POSTGRES=true`.
- `npm run db:studio` — Prisma Studio browser UI for DB inspection
- `npm run db:report` — PostgreSQL diagnostics report
- `npm run data:audit` — data layer health audit (`scripts/data-layer-audit.mjs`)
- `npm run jobs:stale` — report stale job runs
- `ssh autopilot-prod` — passwordless SSH to prod VPS; app lives at `/opt/autopilot`

## Common Issues

**Shopify iframe shows blank / auth loop:**
`SHOPIFY_APP_URL` must be an HTTPS URL. In local dev, start ngrok first and update the env var and the Shopify partner dashboard app URL to match the ngrok HTTPS URL.

**Cron routes return 500 "CRON_SECRET not configured":**
Set `CRON_SECRET` in your `.env`. In local dev without it, routes allow through if `NODE_ENV=development` and `DATABASE_URL` is local (not Neon). In production, `requireCronAuth` always fails closed.

**Database pool exhausted in production:**
Add `?connection_limit=10&pool_timeout=10` to `DATABASE_URL`. The pool exhaustion error appears as timeout errors in Prisma logs. Check `DATABASE_URL_STRICT=true` to enforce this.

**JobRun rows stuck in `running` after a crash:**
PM2 SIGTERM handling in `server.js` should prevent this, but if it happens use Prisma Studio or `npm run db:studio` to manually set the stuck row's status to `failed`. The `jobs:stale` script reports them.

**`npm run db:generate` fails after schema change:**
Run `npm run build:clean` which forces `prisma generate` before the Next.js build (`scripts/build-next.mjs --prisma=always`).
