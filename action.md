# Agriko Autopilot Finish Plan

## Current Blockers

1. Duplicate cron is active.
   Linode has both `/etc/cron.d/autopilot` and root's crontab running the same jobs. That is causing duplicate `JobRun` rows.

2. Deploys can break running cron jobs.
   Recent `fetch-ads-data` failed with Next `ChunkLoadError`, likely because cron hit the app while `.next` chunks were being rebuilt in place.

3. External credentials and permissions are not clean.
   - GSC is returning `403` for `https://agrikoph.com`.
   - Shopify blog fetch recently returned `401`.
   - OpenRouter is returning `403 Key limit exceeded`.
   - Google Ads is only in scope for Market Intelligence keyword research, not ad account reads or execution.
   - Settings UI stores encrypted credentials, but most connectors still read `process.env`, not `ApiCredential`.

4. Execution queue needs triage.
   Live DB has `121 approved`, `16 pending`, `20 failed`, `22 executed` recommendations. Do not treat that as ready-to-run blindly; review before enabling steady execution.

5. Some pilots are unfinished by behavior.
   - Image Pilot generates alt text suggestions but does not write them back to Shopify.
   - Email/Social/SEO are mostly read + AI analysis, not full execution loops.
   - Meta execution does not support all action types the skills can emit.

## Phase 1: Stabilize Operations

- [ ] Remove root crontab duplicate and keep one cron source.
- [ ] Remove literal cron secret from root crontab; read from `/opt/autopilot/.env`.
- [ ] Add JobRun-level locking so duplicate cron/manual clicks cannot run the same job concurrently.
  - Add a schema-backed guard, not only in-memory protection.
  - Preferred approach: add a `JobLock` table keyed by `jobName`, or add a `running` guard that uses an atomic `upsert` / `updateMany` check before starting the job.
  - The existing recommendation-level optimistic lock is not enough; cron routes must refuse or skip duplicate running jobs before invoking handlers.
- [ ] Fix deploy flow so builds happen in a release directory and PM2 switches after build, or pause cron during deploy.
- [ ] Add a "last job health" panel showing failed cron route, error excerpt, and last successful run.

## Phase 2: Fix Live Credentials and Permissions

- [ ] Verify Shopify Admin token/scopes against blog article fetch, product images, and article publish.
- [ ] Add the GSC service account to the exact Search Console property used by `GSC_SITE_URL`.
- [ ] Fix OpenRouter billing/key limit or swap to a valid key/model.
- [ ] Validate Meta token permissions for ads and organic pages.
- [ ] Check Meta access token expiry.
  - Add an expiry check or warning for tokens expiring within 30 days.
  - If refresh is not feasible for the current token type, surface a clear Settings/dashboard alert before expiry.
- [ ] Validate Google Ads keyword research credentials.
  - Google Ads is keyword-planning only for this plugin.
  - Do not use Google Ads for campaign reads, campaign optimization, or live ad execution.
  - Keyword research should use the service-account path when available and must not require a refresh token.

## Phase 3: Make Settings Credentials Real

- [ ] Add a server config resolver with explicit precedence.
  - Decision: encrypted `ApiCredential` wins when present; env is bootstrap fallback.
  - If both DB and env values exist for a key, log a warning that DB is overriding env without printing either value.
- [ ] Wire one connector first as a proof of concept, preferably Shopify Admin because Content Pilot depends on it.
- [ ] Add a credential roundtrip test: save/update a credential via Settings API, then verify the chosen connector reads the DB value.
- [ ] Update Meta, Google Ads keyword research, GA4, GSC, Klaviyo, OpenRouter, and Shopify helpers to use the resolver after the proof of concept passes.
- [ ] Add connector health checks to Settings: configured, auth OK, last fetch OK, last error.

## Phase 4: Close Execution Gaps

- [ ] Audit existing approved/failed recommendations before the next executor run.
- [ ] Either implement Meta `change_bid` / `add_negative_keyword`, or prevent Meta skills from generating unsupported actions.
- [ ] Add execution dry-run mode for first live pass.
  - Add `dryRun Boolean @default(false)` to `JobRun`.
  - Thread `dryRun` through `executeApprovedHandler`.
  - In dry-run mode, perform locking, guardrail re-check, before-state capture, and audit logging, but skip external mutation calls.
  - Store dry-run output as an `AuditLog` record with `action: "execution_dry_run"` and `meta: { dryRun: true }`.
  - Do not write dry-run output to `Recommendation.executionResult`, because that field is reserved for real execution attempts/results.
  - Do not mark dry-run recommendations as `executed`; return them to `approved` / `override_approved` after the simulated pass unless the operator explicitly promotes the result to a live execution.
- [ ] Add tests for unsupported action filtering and connector credential fallback.

## Phase 5: Finish Content Pilot

- [ ] Verify end-to-end: index articles, generate proposals, approve, generate draft, publish to Shopify.
- [ ] Add publish result URL/handle to `ContentProposal`.
  - Add schema fields such as `publishedUrl String?`, `publishedHandle String?`, and/or `shopifyArticleId String?`.
  - Backfill where possible from existing published proposals.
- [ ] Re-index automatically after publish so DB reflects Shopify state.
- [ ] Add reject note modal for content proposals.

## Phase 6 Decision Gate: Pilot Scope

- [ ] Decide before implementation whether Email, Social, and SEO are read-only insight pilots or executable recommendation pilots.
  - Recommended default: keep Email/Social/SEO read-only for this release, label them clearly as insights, and avoid implying they execute changes.
  - Any executable behavior should become a separate future phase with review/approval/audit semantics matching Ad Pilot and Content Pilot.

## Phase 7: Add Market Intelligence Pilot

Working name: **Market Intelligence**.

Purpose: monitor competitor ads, products, pricing, and search visibility so Agriko can make better budget, offer, positioning, and creative decisions. This module should inform Ad Pilot and Content Pilot, but it should not directly mutate ad accounts or Shopify content in its first release.

### Scope Decisions

- [ ] Use **Market Intelligence** as the product/module name unless changed before implementation.
- [ ] Treat Google Ads as a read-only keyword research source only.
  - Capture keyword planning metrics for tracked Market Intelligence keywords.
  - Do not fetch Google Ads campaigns, ad groups, ads, spend, or performance snapshots for this module.
  - Do not create executable Google Ads recommendations from this module.
- [ ] Treat Meta Ad Library as creative intelligence, not performance intelligence.
  - Store what competitors are advertising and how they position offers.
  - Do not imply we can see spend, ROAS, purchases, targeting, or reliable performance metrics from Meta Ad Library.
- [ ] Use a provider/API-first approach for Google Shopping.
  - Preferred: Serper Google Shopping API because the current key is from serper.dev.
  - Alternative: DataForSEO Merchant Google Products API if credentials/cost/reliability make it a better fit.
  - Avoid Playwright Google Shopping scraping for production unless API providers are not viable.
- [ ] Use Meta Ad Library API or a structured third-party provider for ad creative intelligence.
  - Avoid direct scraping of Meta Ad Library unless there is no viable provider/API path.

### Data Model

- [x] Add competitor configuration models.
  - `Competitor`: name, website/domain, notes, active flag.
  - `CompetitorSocialPage`: competitorId, platform, pageName, pageId/url, active flag.
  - `MarketKeyword`: keyword, category/product line, locale/location, active flag.
- [x] Add Google Shopping capture models.
  - `ShoppingResult`: keyword, title, brand, price, currency, store, rating, reviewCount, searchPosition, productUrl, imageUrl, capturedAt, rawPayload.
  - `ShoppingPriceHistory`: product identity key, store, price, currency, capturedAt, previousPrice, priceDelta, priceDeltaPct.
  - Index by keyword, store, product identity key, search position, and capturedAt.
- [x] Add Meta Ad Library capture models.
  - `CompetitorAd`: competitorId, pageName, pageId, adArchiveId, adCopy, headline, description, cta, landingPageUrl, adSnapshotUrl, platforms, startDate, endDate, activeStatus, creativeType, imageUrl/videoUrl, capturedAt, rawPayload.
  - Index by competitorId, activeStatus, startDate, capturedAt, adArchiveId.
- [x] Add insight/alert model.
  - `MarketInsight`: type, severity, competitorId?, keyword?, title, summary, evidence, status, createdAt, resolvedAt.

### Connectors and Jobs

- [x] Add `lib/connectors/dataforseo-shopping.ts`.
  - Query Google Shopping products by active `MarketKeyword`.
  - Store product title, brand, price, currency, store/domain, rating, review count, rank, product URL, image URL, and capture timestamp.
  - Normalize product identity keys so recurring products can be tracked over time.
- [x] Add `lib/connectors/serper-shopping.ts`.
  - Use Serper as the primary Google Shopping source.
  - Keep DataForSEO as fallback.
- [x] Add `lib/connectors/meta-ad-library.ts`.
  - Pull ads for configured competitor pages.
  - Store creative copy, headline, CTA, landing page URL, snapshot URL, platforms, start/end dates, and active status.
  - Preserve raw payload for future fields without schema churn.
- [x] Add `jobs/fetch-market-intel.ts`.
  - Fetch Shopping and Meta Ad Library data.
  - Compute price changes, new product detections, ranking movement, new active ads, and long-running ads.
  - Write `MarketInsight` rows for material changes.
- [x] Add `/api/cron/fetch-market-intel`.
  - Protected by `CRON_SECRET`.
  - Covered by JobRun-level locking from Phase 1.
- [x] Add manual trigger route for authenticated operators.

### Dashboard

- [x] Add embedded route `/market-intelligence`.
- [x] Add navigation section item for Market Intelligence.
- [ ] Dashboard sections:
  - Competitor ad activity: new ads, active ads, long-running ads, repeated hooks/offers/CTAs.
  - Google Shopping watchlist: current product prices, stores, rankings, review counts.
  - Price-change alerts: increases, discounts, new low-price competitors, products entering/leaving results.
  - Positioning insights: recurring claims, offers, bundles, discount language, landing page themes.
- [ ] Add filters by competitor, keyword/category, date range, source, and alert severity.
- [ ] Add "send to Ad Pilot" action that creates a non-executable recommendation or note for ad planning, not a direct ad mutation.

### AI Analysis

- [ ] Add a Market Intelligence analysis endpoint.
  - Inputs: recent competitor ads, Shopping price/rank changes, Agriko product/category context.
  - Outputs: positioning patterns, offer gaps, creative hooks to test, pricing risks, budget guidance.
- [ ] Keep output advisory in the first release.
  - It may create reviewable insights, but not executable ad-account changes.

### Keyword Research

- [x] Add Google Ads keyword research capture for active `MarketKeyword` records.
  - Store average monthly searches, competition, competition index, top-of-page bid ranges, and monthly search volume history.
  - Keep this read-only and advisory.
  - Do not require a Google Ads refresh token for this keyword research path.

### Settings and Credentials

- [ ] Add Settings support for:
  - `DATAFORSEO_LOGIN`
  - `DATAFORSEO_PASSWORD`
  - `SERPAPI_API_KEY` if SerpApi is selected
  - Meta Ad Library access token/provider credentials
- [ ] Use the Phase 3 credential resolver. DB credentials win, env is bootstrap fallback.
- [ ] Add connector health checks for Shopping provider and Meta Ad Library source.

### Acceptance Gate

- [ ] At least 5 competitor/product keywords configured.
- [ ] At least 3 competitor social pages configured.
- [ ] One market-intel cron run stores Google Shopping results.
- [ ] One market-intel cron run stores Meta Ad Library creative records.
- [ ] Price history is recorded across at least two captures.
- [ ] A simulated price change creates a `MarketInsight`.
- [ ] A newly detected competitor ad creates a `MarketInsight`.
- [ ] Dashboard loads and filters by competitor, keyword, and source.
- [ ] AI analysis produces advisory insights without creating executable ad mutations.

## Phase 8: Finish Store, Email, Social, and SEO Pilots

- [ ] Store Pilot: add Shopify image alt-text write-back, not just suggestions.
- [ ] Apply the Phase 6 scope decision to Email/Social/SEO UI copy and navigation.
- [ ] Add pagination for Meta Organic pages/posts.

## Phase 9: Error Alerting and Observability

- [ ] Add failure notifications when a `JobRun` finishes with `status: "failed"`.
  - Use a single `ALERT_WEBHOOK_URL` env var and POST JSON; do not add SMTP/email infrastructure for this release.
  - Payload should include job name, status, timestamp, app URL, and sanitized error excerpt.
  - Do not include secrets or full API responses if they may contain sensitive data.
- [ ] Add an alert for repeated `partial` runs for the same job.
- [ ] Add an alert for stale successful runs, for example no successful `fetch-ads-data` in 24 hours.
- [ ] Add stale-run alert for `fetch-market-intel` once Market Intelligence is enabled.

## Phase 10: Documentation Cleanup

- [ ] Update or replace stale `autopilot.md` and `orchestration/tasks.md`.
- [ ] Remove or clearly archive `render.yaml`, `railway.toml`, and other stale legacy-host references.
- [ ] Create one `OPERATIONS.md` with Linode deploy, cron, env, health checks, and recovery steps.
- [ ] Add a live-change rollback / recovery SOP to `OPERATIONS.md`.
  - Include how to find the `AuditLog` before-state for a recommendation.
  - Include manual reversal steps for Meta and Google Ads changes.
  - Include when to pause `execute-approved` cron before investigating.
  - Include how to mark or annotate a failed/rolled-back recommendation without re-executing it accidentally.

## Final Acceptance Gate

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run typecheck:test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`
- [ ] `npm run db:report`
- [ ] Public `/api/health` returns `db:"ok"`.
- [ ] Each cron route runs once, not twice.
- [ ] Duplicate manual/cron job attempts are skipped by the JobRun-level lock.
- [ ] Shopify embedded app loads in admin.
- [ ] A credential saved via Settings is used by at least one connector in a live or mocked integration test.
- [ ] One full Content Pilot publish succeeds.
- [ ] One approved non-Google-Ads ad recommendation dry-runs with audit log.
- [ ] One approved non-Google-Ads ad recommendation executes live only after dry-run output is reviewed.
- [ ] One Market Intelligence run captures Shopping results and competitor ad records.
- [ ] One Market Intelligence insight is generated from a price/rank/ad-change event.
- [ ] One rollback/recovery SOP walkthrough is documented using an example recommendation.
- [ ] A failed `JobRun` sends a sanitized alert.
- [ ] No current `JobRun` failures after a full daily cycle.
