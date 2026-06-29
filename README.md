# Agriko Autopilot

Agriko Autopilot is a private Shopify embedded app for Agriko marketing operations. It runs inside the Shopify admin, pulls Shopify, ad, SEO, email, and social data into PostgreSQL, generates AI-assisted recommendations and content drafts, and requires operator review before writing changes back to external systems.

This README separates confirmed facts from repo-observed implementation details. Do not infer deployment architecture from old files without checking with the operator.

## Confirmed Context

- This repo has not been pushed to a public repo.
- The app is self-hosted on a Linode VPS (Ubuntu + nginx + certbot) at https://autopilot.agrikoph.com.
- This is an internal Agriko Shopify admin plugin/app, not a public SaaS product.

## Current Architecture

### Runtime Observed in This Repo

- **Framework:** Next.js 16 App Router.
- **Custom server:** `server.js` exists and is wired into package scripts.
- **Start commands:**
  - `npm run dev` -> `node server.js`
  - `npm run start` -> `NODE_ENV=production node server.js`
- **Database:** PostgreSQL through Prisma.
- **UI:** Shopify Polaris and App Bridge inside the Shopify admin iframe.
- **AI:** DeepSeek is the primary skill-runner backend. OpenRouter remains available as fallback and is still used by several older direct-analysis routes until those are migrated.

The actual production host, process manager, and scheduler are operational details. If you need them and they are not already written here, ask instead of guessing.

### Authentication

- Browser/API calls from the embedded app use Shopify App Bridge session tokens.
- API routes verify those tokens through `requireAppAuth()` / `getSessionShop()` in `lib/auth.ts`.
- Cron routes use `Authorization: Bearer $CRON_SECRET`.
- `AUTOPILOT_API_KEY` is server-side only for direct/scripted access. Do not expose it with a `NEXT_PUBLIC_` variable.
- Shopify Admin writes use `SHOPIFY_ADMIN_ACCESS_TOKEN` from server env only.

### Deployment and Operations

- Deployment target: Linode VPS (Ubuntu + nginx reverse proxy + certbot TLS), deployed via `scripts/linode-deploy.mjs` (rsync over SSH) and provisioned via `scripts/linode-setup.mjs`. Domain: https://autopilot.agrikoph.com.
- `server.js` contains startup env validation and graceful shutdown handling.
- Cron scheduling is external to the app process: an external scheduler calls the `/api/cron/*` routes with `Authorization: Bearer $CRON_SECRET` (see `docs/CRON.md`).
- Local Shopify auth still needs a public HTTPS URL, usually via ngrok, because the app loads inside Shopify admin.

## Data Flow

1. External cron or an authenticated operator triggers data jobs.
2. Jobs fetch source data:
   - Shopify blog/articles/products through `lib/shopify-admin.ts`
   - Meta Ads through `lib/connectors/meta.ts`
   - Google Ads through `lib/connectors/google-ads.ts`
   - GA4 and GSC through `lib/connectors/ga4.ts` and `lib/connectors/gsc.ts`
   - Klaviyo through `lib/connectors/klaviyo.ts`
   - Google Shopping market data through `lib/connectors/serper-shopping.ts`, with DataForSEO fallback
   - Meta Ad Library creative data through `lib/connectors/meta-ad-library.ts`
3. Jobs write normalized records:
   - `RawSnapshot` for ad/SEO snapshots
   - `ArticleRecord` for indexed Shopify blog content
   - `ShoppingResult`, `ShoppingPriceHistory`, `CompetitorAd`, and `MarketInsight` for market intelligence
   - `JobRun` for run history
4. Skill runners load Markdown prompts from `skills-source/`, call DeepSeek when configured, fall back to OpenRouter when needed, parse structured JSON, apply guardrails, and write `Recommendation` rows.
5. Operators approve, reject, or override recommendations in the embedded UI.
6. Execution jobs apply approved ad recommendations through connector-specific executors.
7. Content Pilot proposals can generate drafts and publish approved draft content back to Shopify through Admin GraphQL.
8. All important review and execution actions write `AuditLog` rows.

## Main Modules

| Area | Files |
|---|---|
| Embedded UI | `app/(embedded)/**` |
| API routes | `app/api/**` |
| Auth | `lib/auth.ts`, `lib/shopify.ts`, `hooks/use-auth-fetch.ts` |
| Shopify Admin API | `lib/shopify-admin.ts`, `lib/content-pilot/publish-draft.ts` |
| Jobs and cron handlers | `jobs/**`, `app/api/cron/**` |
| Skills system | `lib/skills/loader.ts`, `lib/skills/runner.ts`, `skills-source/**` |
| Guardrails and execution | `lib/guardrails.ts`, `lib/executor.ts`, `jobs/execute-approved.ts` |
| Connectors | `lib/connectors/**` |
| Job locking | `lib/job-lock.ts` |
| Market Intelligence | `jobs/fetch-market-intel.ts`, `app/api/market-intelligence/**`, `app/(embedded)/(market-intelligence)/**` |
| Prisma schema | `prisma/schema.prisma` |

## Key Workflows

### Ad Pilot

- Fetch ad data with `/api/cron/fetch-ads-data`.
- Generate AI recommendations with `/api/cron/run-skills`.
- Review recommendations in `/recommendations`.
- Dry-run approved recommendations with `/api/cron/execute-approved`.
- Live execution requires `EXECUTE_APPROVED_LIVE_ENABLED=true` and `/api/cron/execute-approved?live=true`.

### Content Pilot

- Index Shopify blog content with `/api/cron/fetch-blog-content` or `/api/content-pilot/index`.
- Generate content proposals from indexed article data.
- Approve a proposal.
- Generate a draft.
- Review the draft at `/content-pilot/draft/[id]`.
- Publish to Shopify. The publish route atomically locks `draftStatus: "ready"` to `draftStatus: "publishing"` before calling Shopify to prevent duplicate publishes.

### Shopify Admin Token Refresh

Use the canonical refresh command instead of Shopify CLI login prompts or hand-editing only one env file:

```bash
npm run shopify:refresh-token
```

The shorter legacy alias also works:

```bash
npm run shopify:token
```

The command uses the Shopify client-credentials flow from `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`, validates the token, updates the local theme `.env`, local app `.env`, production `/opt/autopilot/.env`, syncs the `ApiCredential.SHOPIFY_ADMIN_ACCESS_TOKEN` database override, verifies the DB override still matches the server env token, restarts PM2 with `--update-env`, and checks production health. It never prints the token.

To verify current token health without rotating or writing anything:

```bash
npm run shopify:check-token
```

That check validates the local app/theme tokens, the production server env token, the DB-backed `ApiCredential.SHOPIFY_ADMIN_ACCESS_TOKEN` override, and production health. It fails if the DB override and env token drift apart.

For local-only work:

```bash
npm run shopify:refresh-token -- --local-only
```

### SEO, Email, Social, and Images

- SEO data is pulled from GSC and GA4 into snapshots.
- Email data comes from Klaviyo when configured.
- Social data comes from Meta organic endpoints when configured.
- Image optimization reads Shopify product images live and can generate alt text through the configured AI backend; some older direct-analysis routes still use OpenRouter until migrated.

### Market Intelligence

- Configure competitor/product keywords and competitor Facebook/Instagram pages in `/market-intelligence`.
- Capture Google Shopping product/pricing/ranking data with `/api/cron/fetch-market-intel` when Serper credentials are configured.
- Capture competitor ad creative metadata through Meta Ad Library. This is creative intelligence only; it does not expose competitor spend, targeting, ROAS, purchases, or reliable performance metrics.
- Run Google Ads keyword research for tracked keywords to capture monthly searches, competition, and bid ranges when Google Ads API credentials are configured.
- Store captures in `ShoppingResult`, `ShoppingPriceHistory`, and `CompetitorAd`.
- Generate advisory `MarketInsight` rows for changes like new competitor ads and product price movement.
- First release is advisory. It should inform Ad Pilot and Content Pilot planning, not mutate ad accounts or Shopify content directly.

## Environment Variables

Required at startup:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/autopilot?connection_limit=10
CREDENTIALS_ENCRYPTION_KEY=
CRON_SECRET=
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_APP_URL=
SHOPIFY_STORE_DOMAIN=
NEXT_PUBLIC_SHOPIFY_API_KEY=
SCOPES=
DEEPSEEK_API_KEY=
```

Common optional connector variables:

```bash
DEEPSEEK_MODEL=deepseek-v4-flash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
AUTOPILOT_API_KEY=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_PAGE_ID=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_KEYWORD_GEO_TARGET_ID=
GOOGLE_ADS_KEYWORD_LANGUAGE_ID=
GA4_PROPERTY_ID=
GA4_SERVICE_ACCOUNT_JSON=
GA4_SERVICE_ACCOUNT_JSON_PATH=
GSC_SITE_URL=
GSC_SERVICE_ACCOUNT_JSON=
GSC_SERVICE_ACCOUNT_JSON_PATH=
KLAVIYO_API_KEY=
SERPER_API_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
META_AD_LIBRARY_ACCESS_TOKEN=
ALERT_WEBHOOK_URL=
MARKET_INTEL_ENABLED=
MARKET_INTEL_KEYWORD_LIMIT=
MARKET_INTEL_RESULTS_PER_KEYWORD=
MARKET_INTEL_COMPETITOR_PAGE_LIMIT=
MARKET_INTEL_ADS_PER_PAGE_LIMIT=
MARKET_INTEL_DEFAULT_COUNTRY=
MARKET_INTEL_DEFAULT_LOCATION=
```

Secrets live in local/server environment only. Do not commit real values.

Keep `connection_limit=10` on the current single-process Linode deployment. It caps Prisma's pool so the app leaves room for migrations, `psql`, and Postgres maintenance workers.

Postgres query statistics are enabled on Linode through `pg_stat_statements`. Run `npm run db:report` with `DATABASE_URL` loaded to inspect connection pressure, cache hit rate, table bloat signals, and top query fingerprints.

## Quick Start

```bash
cd autopilot-app
cp .env.example .env.local
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

For embedded Shopify testing:

```bash
ngrok http 3000
```

Set `SHOPIFY_APP_URL` to the ngrok HTTPS URL and update the Shopify app URL if needed.

## Cron Routes

All cron routes require:

```bash
Authorization: Bearer $CRON_SECRET
```

Routes:

| Route | Purpose |
|---|---|
| `/api/cron/daily` | Runs the daily fetch/index/generate pipeline shortcut |
| `/api/cron/fetch-ads-data` | Pulls ad platform snapshots |
| `/api/cron/fetch-seo-data` | Pulls GSC and GA4 snapshots |
| `/api/cron/fetch-blog-content` | Indexes Shopify blog articles |
| `/api/cron/fetch-market-intel` | Captures market keyword shopping results and competitor Meta Ad Library creatives |
| `/api/cron/fetch-keyword-research` | Captures Google Ads keyword planning metrics for tracked Market Intelligence keywords |
| `/api/cron/run-skills` | Runs enabled Markdown skills against latest snapshots |
| `/api/cron/execute-approved` | Dry-runs approved and override-approved recommendations by default; live execution requires `?live=true` plus `EXECUTE_APPROVED_LIVE_ENABLED=true` |

Example:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/fetch-ads-data
```

## Tests

```bash
npm test
npm run test:watch
npm run test:coverage
npm run typecheck:test
```

## Notes for Future Agents

- This repo has not been pushed to a public repo.
- The app is deployed to a Linode VPS (nginx + certbot) at https://autopilot.agrikoph.com via `scripts/linode-deploy.mjs`.
- Do not suggest rotating secrets solely because a local-only script once contained them.
- Do not reintroduce `NEXT_PUBLIC_AUTOPILOT_API_KEY`.
- Prefer the existing auth, connector, job, and skill patterns before adding new abstractions.
- Keep generated build artifacts like `tsconfig*.tsbuildinfo` out of intentional changes.

## Additional Docs

| Doc | Contents |
|---|---|
| [autopilot.md](autopilot.md) | Deeper architecture, schema, API routes, skills system, guardrails |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, tests, adding connectors and skills |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Older deployment/env reference, partially stale |
| [docs/CRON.md](docs/CRON.md) | Cron route details and suggested external scheduler timings |
| [docs/COMPLETION_PLAN.md](docs/COMPLETION_PLAN.md) | Comprehensive finish plan for the whole custom app |
| [docs/MARKET_INTELLIGENCE.md](docs/MARKET_INTELLIGENCE.md) | Detailed Market Intelligence data, workflow, and completion plan |
