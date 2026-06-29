# Agriko Autopilot Completion Plan

This document is the comprehensive completion plan for the custom Agriko Shopify embedded app. It covers the whole app, including Ad Pilot, Content Pilot, Market Intelligence, SEO, Email, Social, Store/Image tools, operations, credentials, observability, tests, and release gates.

The app is not a public SaaS product. It is a private Agriko admin plugin/app. It is self-hosted on a Linode VPS (Ubuntu + nginx + certbot) at https://autopilot.agrikoph.com.

## Executive Summary

The app is materially wired, but not finished.

What is already present:

- Next.js embedded Shopify app shell.
- Shopify App Bridge session-authenticated app routes.
- Cron routes protected by `CRON_SECRET`.
- PostgreSQL/Prisma persistence.
- `JobRun` history.
- schema-backed `JobLock` concurrency guard.
- encrypted credential storage UI/API.
- ad snapshot collection.
- AI skill runner.
- recommendation review flow.
- guarded execution flow for approved recommendations.
- Content Pilot indexing/proposal/draft/publish flow.
- Market Intelligence schema/jobs/connectors/UI.
- SEO, Email, Social, Store/Image first-pass modules.
- Linode deploy scripts (`scripts/linode-deploy.mjs`, `scripts/linode-setup.mjs`) and self-hosted nginx + certbot posture.

The main remaining work is not wiring every screen from scratch. The remaining work is turning the current system into a controlled, observable, safe operator tool:

- make credentials real across connectors
- consolidate AI config so DeepSeek is primary and OpenRouter is fallback/legacy support
- finish module-specific gaps
- prevent broad/expensive accidental runs
- clarify which pilots are advisory versus executable
- add dry-run and rollback discipline around execution
- add health checks and alerts
- improve dashboards from raw tables into operator workflows
- run final end-to-end acceptance gates

## Current Module Status

| Area | Current status | Completion status |
|---|---|---|
| App shell/auth | Embedded routes and auth helpers exist | Needs final Shopify embedded smoke test |
| Deployment | Linode deploy scripts exist (nginx + certbot, self-hosted) | Needs operations doc and deploy/cron SOP |
| Database | Prisma schema and migrations exist | Needs final migration audit and backup/restore SOP |
| Job locking | `JobLock` exists and cron/manual routes use it | Needs coverage for all job entry points and health UI updates |
| Credentials | UI/API stores encrypted credentials | Needs connector resolver and health checks |
| Ad Pilot | Fetch, skill generation, review, guardrails, execution exist | Needs dry-run, unsupported action filtering, queue audit |
| Content Pilot | Index/propose/approve/draft/publish exists | Needs publish metadata, re-index after publish, final E2E |
| Market Intelligence | Schema/jobs/connectors/UI exist | Needs safe run profiles, target model, attribution, dashboard, analysis |
| SEO Pilot | Data/API/UI exists | Needs scope decision: advisory only for first release |
| Email Pilot | Klaviyo/API/UI exists | Needs scope decision and health checks |
| Social Pilot | Meta organic/API/UI exists | Needs pagination, scope decision, health checks |
| Store/Image Pilot | Product image/alt-text flow exists | Needs Shopify write-back if it is meant to execute |
| Observability | Job status exists | Needs alerts, stale-run detection, source health |
| Tests | Unit/smoke tests exist | Needs E2E and integration acceptance tests |

## Product Decisions Needed Before Final Build

These decisions should be written down before implementation continues:

1. Google Ads scope:
   - Decision already made: Google Ads is keyword research only for Market Intelligence.
   - Do not wire Google Ads campaign reads or mutations into the release path.

2. Pilot execution scope:
   - Recommended release posture:
     - Ad Pilot: executable, but only after dry-run and review.
     - Content Pilot: executable publish flow, with review.
     - Market Intelligence: advisory only.
     - SEO: advisory only.
     - Email: advisory only.
     - Social: advisory only.
     - Store/Image: advisory unless write-back is explicitly approved.

3. Market Intelligence Meta source:
   - Preferred long-term: Meta Ad Library API when access is approved.
   - Temporary: Playwright public-page fallback with hard caps.
   - No CAPTCHA/login/security bypass.

4. Paid API controls:
   - Manual runs must use safe run profiles and caps.
   - Scheduled runs must have daily source caps.

5. Recommendation execution:
   - No functionality removal without explicit discussion.
   - Unsupported actions should be blocked at generation/review time, not silently dropped after approval.

6. AI backend:
   - DeepSeek is the primary backend for the skill runner.
   - OpenRouter remains fallback and is still used by several older direct-analysis routes until they are migrated.
   - Completion work should move AI callers behind one provider resolver instead of leaving module routes to instantiate OpenRouter directly.

## Data Operating Model

The app should be designed around a clear data lifecycle. The mistake to avoid is dumping source payloads into tables and then asking the UI or AI to figure out what matters. Every module should move through the same layers:

1. Raw source capture.
2. Normalized source facts.
3. Historical observations.
4. Deterministic signals.
5. Human-readable insights.
6. Operator actions.
7. Audited execution or advisory handoff.

### Layer 1: Raw Source Capture

Raw captures preserve what the external system returned so parsers can improve later without losing evidence.

Current examples:

- `RawSnapshot` for ad, SEO, email, and social snapshots.
- `ShoppingResult.rawPayload`
- `CompetitorAd.rawPayload`
- `KeywordResearchResult.rawPayload`

Rules:

- Raw payloads should be retained, but bounded.
- Strip inline image/data blobs.
- Never store secrets.
- Store source name, request context, capture time, and job run ID.
- Raw data should not be the primary dashboard contract.

Needed improvements:

- Add a consistent `source`, `sourceVersion`, and `requestContext` pattern.
- Add retention rules by source.
- Add payload-size protection.
- Add scrubber tests for secrets and inline blobs.

### Layer 2: Normalized Source Facts

Normalized facts are stable records the rest of the app can trust.

Examples:

- `ShoppingResult`: one product result for one keyword capture.
- `ShoppingPriceHistory`: one price observation for one product key.
- `CompetitorAd`: one known ad creative/archive identity.
- `KeywordResearchResult`: one keyword metric result.
- `ArticleRecord`: one indexed Shopify article state.
- `Recommendation`: one reviewable action or advisory recommendation.

Rules:

- Normalize source-specific naming into app-level field names.
- Keep raw payload as evidence, not as the app contract.
- Link every capture to `JobRun` where possible.
- Use stable external IDs when available.
- Use stable derived keys only when external IDs do not exist.

Needed improvements:

- Add `CompetitorAdCapture` so one ad can be found by multiple targets/runs without losing attribution.
- Add normalized product identity fields beyond `productKey`:
  - normalized title
  - normalized store
  - canonical product URL where possible
  - category
  - confidence
- Add source confidence fields for scraped Meta data.

### Layer 3: Historical Observations

Historical tables answer "what changed over time?"

Current examples:

- `ShoppingPriceHistory`
- repeated `ShoppingResult` captures
- repeated `KeywordResearchResult` captures
- repeated `RawSnapshot` captures
- repeated `JobRun` summaries

Rules:

- Do not overwrite history when a new capture occurs.
- Upsert stable entities, append observations.
- Store the run/profile that created the observation.
- Preserve enough context to explain why an insight fired.

Needed improvements:

- Add rank history for shopping results.
- Add ad capture history separate from the ad identity.
- Add keyword metric trend snapshots.
- Add retention/rollup strategy:
  - detailed observations for recent period
  - daily summaries for longer-term trend charts

### Layer 4: Deterministic Signals

Signals are computed facts, not AI opinions.

Examples:

- price increased by 12%
- product entered top 10 for a keyword
- product disappeared from results
- competitor launched a new ad
- active ad has been running for more than 30 days
- keyword has high volume and low competition
- job failed three times in a row

Rules:

- Signals should be reproducible from stored observations.
- Store thresholds used at the time the signal was created.
- Keep signal evidence small and specific.
- Do not let AI create source-of-truth metrics.

Needed improvements:

- Add a `MarketSignal` table or formalize `MarketInsight.type` as deterministic/advisory.
- Add signal de-duplication rules.
- Add status lifecycle:
  - open
  - acknowledged
  - resolved
  - ignored
- Add severity policy:
  - info for ordinary changes
  - warning for budget/positioning threats
  - critical only for operational failure or high-risk execution

### Layer 5: Human-Readable Insights

Insights explain why a signal matters and what an operator might do.

Examples:

- "Competitor X has kept this turmeric ad active for 47 days; review its hook and landing page."
- "Raw honey prices dropped 18% for one store; review Agriko price positioning."
- "Organic black rice has search demand but weak shopping competition; consider content or product-page expansion."

Rules:

- Insights should reference underlying records.
- Insights should say whether they are deterministic or AI-assisted.
- Insights should not imply unavailable data, such as competitor ROAS or targeting.
- Insights should be advisory unless routed into a reviewable execution workflow.

Needed improvements:

- Add `evidenceRefs` pattern:
  - source table
  - record ID
  - capturedAt
  - source URL when available
- Add insight grouping so repeated signals do not flood the UI.
- Add "why this matters" and "suggested next step" fields.

### Layer 6: Visualization

The UI should not be a raw database browser. Each module needs views built around operator decisions.

Global dashboard needs:

- job health
- connector health
- open critical issues
- pending approvals
- stale data warnings
- recent important insights

Ad Pilot views:

- pending recommendations
- hard-blocked recommendations
- approved queue
- dry-run results
- execution audit
- failed/recovery queue

Content Pilot views:

- indexed content health
- proposal queue
- draft review
- publish status
- stale content opportunities
- internal-link opportunities

Market Intelligence views:

- Overview:
  - new competitor activity
  - long-running active Meta ads
  - material price changes
  - keyword opportunities
- Shopping:
  - keyword result table
  - price history
  - rank history
  - store comparison
- Meta Ads:
  - active ads
  - ads older than 30 days
  - new ads
  - hooks/offers/CTAs
  - competitor/page/keyword filters
- Keyword Research:
  - volume
  - competition
  - bid ranges
  - trends
- Targets:
  - tracked keywords
  - competitor pages
  - Meta keyword searches
  - run caps
- Runs/Health:
  - last run by source
  - partial/failure causes
  - daily API usage/caps

SEO/Email/Social views:

- advisory insights first
- source health
- recent data
- recommended next actions
- no implied execution unless explicitly enabled

Visualization rules:

- Every chart/table should answer an operator question.
- Every insight should link back to evidence.
- Filters should exist before data volume grows:
  - source
  - date range
  - severity
  - status
  - competitor
  - keyword/category
  - module

### Layer 7: Analysis

Analysis should happen in two passes:

1. deterministic analysis
2. bounded AI analysis

Deterministic analysis:

- computes changes, thresholds, and trend signals
- stores reproducible outputs
- runs safely on every scheduled job

AI analysis:

- reads only normalized, bounded, recent data
- receives evidence references
- produces advisory summaries and suggested next steps
- cannot directly mutate external systems
- cannot invent unavailable metrics

AI analysis prompt rules:

- include source limitations
- require citations to stored records
- require confidence level
- require "do not know" when evidence is insufficient
- forbid claims about private competitor performance

Needed implementation:

- Add per-module analysis payload builders.
- Add analysis budget limits.
- Add AI output schema:
  - title
  - summary
  - evidenceRefs
  - confidence
  - suggestedAction
  - advisoryOnly
  - relatedModule
- Store AI outputs as `MarketInsight` or a generalized `Insight` model if cross-module.

### Layer 8: Acting on Data

Actions must be explicit, reviewed, and audited.

Action categories:

- advisory note
- content proposal
- ad recommendation
- settings/config change
- external mutation

Allowed first-release actions:

- Create advisory insights.
- Create Content Pilot proposals.
- Create reviewable ad recommendations only for supported actions.
- Publish Shopify content only after review.
- Execute approved ad actions only after dry-run and support validation.

Not allowed in first release:

- Market Intelligence directly changing ad budgets.
- Market Intelligence directly launching ads.
- SEO directly editing Shopify pages without review.
- Email directly sending campaigns.
- Social directly posting content.
- Google Ads execution.

Required action flow:

1. Insight is created with evidence.
2. Operator reviews.
3. Operator chooses an action:
   - resolve
   - ignore
   - create content proposal
   - create planning note
   - create reviewable recommendation
4. If executable, run dry-run first.
5. Operator reviews dry-run result.
6. Live execution happens only for supported, approved actions.
7. `AuditLog` records before/after or failure.

## Data Model Improvements Needed

These are the main schema changes needed to support the operating model.

### Cross-App

- [x] Add `ConnectorHealth` or derive a consistent source-health response from `JobRun`.
- [ ] Add `Insight` model or extend `MarketInsight` only if insights stay market-specific.
- [ ] Add `InsightEvidenceRef` if JSON evidence becomes too hard to query.
- [ ] Add `JobRun.profile`, `JobRun.source`, and `JobRun.dryRun`.
  - [x] Added `JobRun.dryRun`.
  - [ ] Add `JobRun.profile`.
  - [ ] Add `JobRun.source`.
- [ ] Add retention/rollup fields for historical observations.

### Market Intelligence

- [ ] Add `MarketAdSearchTarget`.
- [ ] Add `CompetitorAdCapture`.
- [ ] Add `ShoppingRankHistory` or extend shopping observations to support rank movement.
- [ ] Add source confidence fields for scraped Meta records.
- [ ] Add normalized product/category fields.

### Content Pilot

- [ ] Add publish metadata:
  - `publishedUrl`
  - `publishedHandle`
  - `shopifyArticleId`
- [ ] Decide whether draft revisions need their own table.

### Execution

- [x] Add `JobRun.dryRun`.
- [x] Add dry-run audit records.
- [x] Add unsupported-action rejection reason or status.

## Phase 1: Stabilize Operations

Goal: make the runtime predictable before adding more intelligence or execution.

Tasks:

- [x] Move to self-hosted Linode (nginx + certbot) deploy scripts.
- [x] Use schema-backed `JobLock` for cron/manual job concurrency.
- [x] Build into a staging `.next.new` directory and swap after build.
- [x] Keep server-owned `.env` out of deploy sync.
- [x] Keep service account JSON out of deploy sync.
- [x] Keep local `tmp` out of deploy sync.
- [ ] Exclude all generated build artifacts from intentional deploys, including `tsconfig*.tsbuildinfo`.
- [x] Confirm only one scheduler source is active on Linode.
- [ ] Confirm every cron route uses `JobLock`.
- [ ] Add a cron/deploy SOP:
  - how to deploy
  - how to pause cron
  - how to restart PM2
  - how to inspect logs
  - how to roll back app code
  - how to verify DB connectivity
- [ ] Add backup/restore SOP for Postgres.

Acceptance gate:

- [ ] One deploy completes with no local env/secrets overwritten.
- [ ] A cron route triggered twice concurrently returns one success and one skip.
- [ ] PM2 app restarts cleanly.
- [ ] `/api/health` returns DB OK.
- [ ] `npm run db:report` runs against the live DB.

## Phase 2: Credential Resolver and Connector Health

Goal: make Settings credentials actually drive connectors.

Current state:

- Settings can create/update/delete encrypted `ApiCredential` rows.
- Values are not exposed after saving.
- Most connectors still read `process.env` directly.

Required design:

- Add a server-side credential/config resolver.
- Precedence:
  - DB credential wins if present.
  - env is bootstrap fallback.
  - if both exist and differ, warn without printing either value.
- Add connector health checks:
  - configured
  - auth OK
  - last successful fetch
  - last error
  - permission/scope hints

Tasks:

- [x] Add `lib/config/resolver.ts`.
- [x] Add typed helpers:
  - `getSecret("SHOPIFY_ADMIN_ACCESS_TOKEN")`
  - `getOptionalSecret("META_ACCESS_TOKEN")`
  - `getConnectorConfig("google_ads_keyword_research")`
- [x] Add tests for DB-over-env precedence.
- [x] Wire one connector first, preferably Shopify Admin.
- [x] Add a credential roundtrip test:
  - [x] save credential through Settings API
  - [x] connector reads DB value
  - [x] env fallback still works when DB value is absent
- [ ] Wire remaining connectors:
  - [x] Shopify Admin
  - [x] DeepSeek
  - [x] OpenRouter
  - [x] Meta
  - [x] Meta Organic
  - [x] Meta Ad Library
  - [x] Google Ads keyword research
  - [x] GA4
  - [x] GSC
  - [x] Klaviyo
  - [x] Serper
  - [x] DataForSEO
- [x] Add Settings UI health/status cards per connector.
  - [x] Added configuration health endpoint and Settings table.
  - [x] Shows DB/env/missing source metadata without exposing values.
  - [x] Does not call paid or external APIs during health checks.
- [x] Add minimal `ALERT_WEBHOOK_URL` support for failed jobs during this phase, so credential/token failures do not silently recur.
- [x] Migrate older direct-analysis routes to the same AI provider resolver:
  - [x] SEO analyze/brief
  - [x] Email analyze
  - [x] Social analyze
  - [x] Images
  - [x] Content brief/draft generation where applicable

Acceptance gate:

- [ ] Settings-saved credential is used by at least one live connector.
- [ ] No connector logs secret values.
- [ ] Missing credential produces a clear disabled/health result, not an unhandled crash.
- [ ] DB credential can be deleted and env fallback resumes.

## Phase 3: Job Health, Alerts, and Observability

Goal: failures should be visible without someone manually inspecting the database.

Current state:

- `JobRun` records exist.
- `/api/jobs/status` exposes per-job health for core jobs.
- Market Intelligence job health is not fully integrated everywhere.

Tasks:

- [ ] Add all jobs to status health:
  - `fetch-market-intel`
  - `fetch-keyword-research`
- [ ] Add source health inside job summaries:
  - Shopify
  - Meta Ads
  - Meta Organic
  - Meta Ad Library
  - GSC
  - GA4
  - Klaviyo
  - Serper/DataForSEO
  - Google Ads keyword research
  - DeepSeek
  - OpenRouter
- [ ] Add `ALERT_WEBHOOK_URL` support.
- [ ] Send sanitized alert on:
  - failed job
  - repeated partial runs
  - no successful run within expected interval
  - connector auth failure
- [ ] Add an Operations dashboard section:
  - latest jobs
  - last success
  - error excerpt
  - source status
  - currently held locks
- [ ] Add manual clear/expire stale lock admin action.

Acceptance gate:

- [ ] A forced failed job creates a failed `JobRun`.
- [ ] The failed job appears in UI health.
- [ ] Alert webhook receives sanitized JSON.
- [ ] No alert includes secrets or full raw external payloads.

## Phase 4: Ad Pilot Completion

Goal: make ad recommendations safe, auditable, and honest about supported actions.

Current state:

- Ad data fetch exists.
- Skill runner creates recommendations.
- Recommendation approval/reject/override routes exist.
- Guardrails exist.
- Execution route exists.
- `AuditLog` is written for review and execution events.
- Executor routes to Meta and Google Ads connectors.

Known issues:

- Google Ads should not be used for execution in this release.
- Some skills may emit unsupported actions.
- There is no proper dry-run mode yet.
- Existing approved queue must be audited before running execution.

Tasks:

- [x] Add supported-action registry by platform.
- [ ] Filter or hard-block unsupported actions before recommendation creation.
- [x] Disable Google Ads execution path for this release unless explicitly re-approved.
- [x] Add execution dry-run:
  - [x] `JobRun.dryRun Boolean @default(false)`
  - [x] pass dry-run into `executeApprovedHandler`
  - [x] keep dry-run non-mutating for recommendation status
  - [x] re-check guardrails
  - [x] capture before-state
  - [x] write `AuditLog` with `action: "execution_dry_run_*"`
  - [x] do not mutate external systems
  - [x] do not mark recommendation `executed`
- [x] Add UI button or route for dry-run approved queue.
  - Route: `/api/cron/execute-approved?dryRun=true`
- [ ] Add queue audit view:
  - approved count
  - override-approved count
  - failed count
  - unsupported action count
  - stale approval count
- [x] Add manual recovery SOP:
  - [x] inspect before-state
  - [x] reverse external change manually
  - [x] annotate recommendation/audit log
  - [x] prevent accidental re-execution

Acceptance gate:

- [ ] One approved Meta recommendation dry-runs with audit log.
- [x] Unsupported action cannot execute.
- [ ] Existing approved queue is reviewed before live executor is enabled.
- [ ] Live execution is only enabled after dry-run output is reviewed.

## Phase 5: Content Pilot Completion

Goal: make Shopify content workflows complete and recoverable.

Current state:

- Shopify article indexing exists.
- Proposal generation exists.
- Proposal approval/rejection exists.
- Draft generation exists.
- Draft review page exists.
- Publish route exists and locks draft status before publishing.

Tasks:

- [ ] Add publish metadata to `ContentProposal`:
  - `publishedUrl`
  - `publishedHandle`
  - `shopifyArticleId`
- [ ] Store Shopify publish result on success.
- [ ] Re-index Shopify after publish.
- [ ] Add reject note modal if missing or incomplete.
- [ ] Add draft regeneration/versioning decision:
  - overwrite latest draft, or
  - keep draft revisions
- [ ] Add publish failure recovery:
  - status returns from `publishing` to `ready` or `failed`
  - error shown in UI
  - audit log written
- [ ] Add E2E test around proposal -> draft -> publish using mocked Shopify.

Acceptance gate:

- [ ] One article index run succeeds.
- [ ] One proposal is generated.
- [ ] One proposal is approved.
- [ ] One draft is generated and reviewed.
- [ ] One publish succeeds and stores Shopify metadata.
- [ ] Re-index reflects published state.

## Phase 6: Market Intelligence Completion

Goal: turn the currently wired module into safe, useful competitive intelligence.

Detailed plan:

- See `docs/MARKET_INTELLIGENCE.md`.

High-level tasks:

- [ ] Add safe run profiles:
  - smoke
  - shopping
  - Meta pages
  - Meta keywords
  - keyword research
  - scheduled
- [ ] Add hard source caps and daily caps.
- [ ] Formalize Meta keyword/search targets instead of using `CompetitorSocialPage.platform = "meta_keyword"`.
- [ ] Add `CompetitorAdCapture` so one ad can be linked to every target/run that found it.
- [ ] Harden Meta parser with fixtures and confidence fields.
- [ ] Add deterministic insights:
  - new product
  - product disappeared
  - price change
  - rank movement
  - new ad
  - active ad running more than 30 days
  - repeated hook/offer/CTA
- [ ] Add dashboard tabs/filters:
  - Overview
  - Shopping
  - Meta Ads
  - Keyword Research
  - Insights
  - Targets
  - Runs/Health
- [ ] Add bounded AI analysis over normalized data only.
- [ ] Keep all outputs advisory in first release.

Acceptance gate:

- [ ] One smoke run captures one shopping keyword and one Meta target.
- [ ] One keyword research run stores Google Ads keyword metrics.
- [ ] Active Philippines niche ads can be captured when available.
- [ ] Active ad older than 30 days creates a long-running insight.
- [ ] Dashboard filters work.
- [ ] No scheduled collection is enabled until run profiles and caps exist.

## Phase 7: SEO Pilot Completion

Goal: make SEO useful as an advisory planning module.

Current state:

- SEO routes/UI exist.
- GSC and GA4 connectors exist.
- SEO analyzer/brief endpoints exist.
- SEO skills exist.

Tasks:

- [ ] Confirm GSC property/scopes.
- [ ] Confirm GA4 property/scopes.
- [ ] Add connector health cards.
- [ ] Mark SEO as advisory in UI unless execution is later approved.
- [ ] Add page-level SEO history:
  - title
  - meta description
  - canonical
  - headings
  - internal links
  - GSC clicks/impressions/CTR/position
- [ ] Add SEO issue status:
  - open
  - accepted
  - resolved
  - ignored
- [ ] Connect SEO insights to Content Pilot proposal generation where relevant.

Acceptance gate:

- [ ] GSC fetch succeeds.
- [ ] GA4 fetch succeeds.
- [ ] SEO dashboard shows latest data and errors clearly.
- [ ] SEO can generate advisory insight/proposal without external mutation.

## Phase 8: Email Pilot Completion

Goal: clarify whether Email Pilot is advisory or execution-capable.

Recommended first release: advisory only.

Current state:

- Klaviyo connector/routes/UI exist.
- Email analysis endpoint exists.

Tasks:

- [ ] Confirm Klaviyo credential/scopes.
- [ ] Add Klaviyo health check.
- [ ] Add explicit UI label: advisory only.
- [ ] Add email data snapshots:
  - campaigns
  - flows
  - subject lines
  - open/click/purchase metrics where available
- [ ] Add deterministic insights:
  - low open rate
  - low click rate
  - high unsubscribe/spam risk
  - stale flow
  - repeated winner themes
- [ ] Add optional content handoff:
  - generate subject-line ideas
  - generate campaign brief
  - no auto-send

Acceptance gate:

- [ ] Klaviyo fetch succeeds or shows clear disabled state.
- [ ] Email dashboard shows recent campaign/flow data.
- [ ] Advisory analysis can run without sending email.

## Phase 9: Social Pilot Completion

Goal: use Meta organic data for advisory social/content planning.

Recommended first release: advisory only.

Current state:

- Meta organic connector exists.
- Social routes/UI exist.
- Social analysis endpoint exists.

Tasks:

- [ ] Confirm Meta page permissions.
- [ ] Add token expiry warning.
- [ ] Add pagination for pages/posts.
- [ ] Add source health card.
- [ ] Add organic performance snapshots:
  - posts
  - engagement
  - reach/impressions where available
  - media type
  - permalink
- [ ] Add advisory insights:
  - top post themes
  - weak post formats
  - best posting windows if data supports it
  - content repurposing candidates
- [ ] Add handoff to Content Pilot / planning notes.

Acceptance gate:

- [ ] Meta organic fetch succeeds or shows clear permission error.
- [ ] Posts paginate beyond first page.
- [ ] Advisory analysis runs without publishing social content.

## Phase 10: Store and Image Pilot Completion

Goal: decide whether the module only recommends product/image improvements or writes them to Shopify.

Current state:

- Image/product routes/UI exist.
- Alt-text generation exists or is partially wired.

Tasks:

- [ ] Decide execution scope:
  - advisory only, or
  - Shopify alt-text write-back after review.
- [ ] If write-back is approved:
  - add approval flow
  - add before-state capture
  - write alt text through Shopify Admin
  - audit every mutation
  - add rollback instructions
- [ ] Add product image dashboard:
  - missing alt text
  - duplicate alt text
  - oversized images
  - weak product metadata
- [ ] Add filters by product, collection, status.

Acceptance gate:

- [ ] Product image fetch succeeds.
- [ ] Suggestions are generated.
- [ ] If write-back is in scope, one reviewed write-back succeeds and is audited.

## Phase 11: UI and Navigation Hardening

Goal: make the embedded app feel like one coherent operator tool.

Tasks:

- [ ] Review navigation labels and module grouping.
- [ ] Make advisory vs executable modules visually clear.
- [ ] Add consistent empty states.
- [ ] Add consistent loading/error handling.
- [ ] Add pagination to large tables.
- [ ] Add filters where tables can exceed 50 rows.
- [ ] Add audit-log access from relevant detail pages.
- [ ] Add mobile/iframe layout checks for Shopify admin.

Acceptance gate:

- [ ] Every nav item loads.
- [ ] Every table has a useful empty state.
- [ ] Long text does not break layout.
- [ ] Errors are actionable and do not expose secrets.

## Phase 12: Testing Plan

Goal: make final release testable without relying on manual inspection.

Existing scripts:

- `npm test`
- `npm run lint`
- `npm run typecheck:test`
- `npm run build`
- `npm run db:report`

Needed tests:

- [x] Credential resolver unit tests.
- [ ] Connector disabled-state tests.
- [ ] JobLock concurrency tests.
- [ ] Market Intelligence run-profile tests.
- [ ] Meta parser fixture tests.
- [ ] Recommendation unsupported-action tests.
- [x] Execution dry-run tests.
- [ ] Content publish mocked integration test.
- [x] Settings credential roundtrip test.
- [x] Health endpoint tests.

Final command gate:

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run typecheck:test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`
- [ ] `npm run db:report`

## Phase 13: Documentation and Handoff

Goal: make the app maintainable by someone else.

Tasks:

- [ ] Keep `README.md` as high-level architecture and setup.
- [x] Add/finish `docs/OPERATIONS.md`.
- [ ] Keep `docs/MARKET_INTELLIGENCE.md` as the detailed Market Intelligence plan.
- [ ] Keep this document as the master completion plan.
- [ ] Add connector setup guide:
  - Shopify
  - Meta Ads
  - Meta Organic
  - Meta Ad Library
  - Google Ads keyword research
  - GSC
  - GA4
  - Klaviyo
  - Serper/DataForSEO
  - OpenRouter
- [ ] Add rollback/recovery guide:
  - [x] recommendation execution
  - Shopify content publish
  - Shopify alt-text write-back if enabled
  - failed cron
  - stuck lock
  - bad deploy

Acceptance gate:

- [ ] A new developer can read docs and identify:
  - where app runs
  - how deploy works
  - where env lives
  - how cron works
  - how to stop jobs
  - how credentials are resolved
  - what each module does
  - what is advisory vs executable

## Final Release Gate

The app is release-complete when every item below is true:

- [ ] No duplicate scheduler exists.
- [ ] All cron routes are locked.
- [ ] Settings credentials are used by connectors.
- [ ] Connector health is visible in UI.
- [ ] Failed/stale jobs alert through webhook.
- [x] Ad Pilot dry-run works.
- [ ] Existing approved recommendation queue has been audited.
- [ ] Live ad execution is enabled only for supported non-Google-Ads actions.
- [ ] Content Pilot publish E2E passes.
- [ ] Market Intelligence safe run profiles and caps exist.
- [ ] Market Intelligence captures Shopping, Meta, and keyword research data.
- [ ] Market Intelligence dashboard supports core filters.
- [ ] SEO, Email, Social are clearly labeled advisory unless explicitly changed.
- [ ] Store/Image execution scope is decided and implemented accordingly.
- [ ] All final test commands pass.
- [x] Operations and rollback docs exist.
- [ ] No known current `JobRun` failures remain after a full daily cycle.

## Practical Next Sprint Order

Recommended order from here:

1. Credential resolver, connector health, AI provider resolver, and minimal failed-job webhook alert.
2. Full operations/stale-run monitoring.
3. Ad Pilot dry-run and unsupported-action filtering.
4. Content Pilot publish metadata and E2E.
5. Market Intelligence run profiles, caps, target attribution.
6. Market Intelligence dashboard and deterministic insights.
7. SEO/Email/Social advisory polish and health checks.
8. Store/Image scope and write-back decision.
9. Full test/build/db/report gate.
10. Final documentation pass.
