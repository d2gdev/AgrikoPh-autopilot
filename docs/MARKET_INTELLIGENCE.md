# Market Intelligence Plan

Market Intelligence is the advisory module for competitor products, pricing, keyword demand, and Meta Ad Library creative monitoring in the Philippines. It should inform campaign planning, offers, product positioning, and content direction. It should not directly mutate ad accounts, Shopify products, or Shopify content in its first release.

## Current Wiring

The module is no longer just scaffolded. These pieces exist in the repo:

- Data models:
  - `Competitor`
  - `CompetitorSocialPage`
  - `MarketKeyword`
  - `ShoppingResult`
  - `ShoppingPriceHistory`
  - `CompetitorAd`
  - `MarketInsight`
  - `KeywordResearchResult`
- Collection jobs:
  - `jobs/fetch-market-intel.ts`
  - `jobs/fetch-keyword-research.ts`
- API routes:
  - `/api/market-intelligence`
  - `/api/market-intelligence/config`
  - `/api/market-intelligence/trigger`
  - `/api/market-intelligence/keyword-research`
  - `/api/cron/fetch-market-intel`
  - `/api/cron/fetch-keyword-research`
- Connectors:
  - Google Shopping through Serper in `lib/connectors/serper-shopping.ts`
  - DataForSEO fallback in `lib/connectors/dataforseo-shopping.ts`
  - DataForSEO Labs (ranked keywords + keyword gap) in `lib/connectors/dataforseo-labs.ts`
  - DataForSEO bulk search-volume keyword research in `lib/connectors/dataforseo-keywords.ts`
  - Meta Ad Library API/fallback coordinator in `lib/connectors/meta-ad-library.ts`
  - Temporary Playwright Meta Ad Library fallback in `lib/connectors/meta-ad-library-scraper.ts`
- UI:
  - `/market-intelligence`
  - Navigation entry under Competitors / Market Intelligence
- Job controls:
  - Cron and manual trigger routes use `JobLock`.
  - Captured records are linked to `JobRun` where implemented.

## Sources and What We Can Get

### Google Shopping

Primary source: Serper Google Shopping.

Stored fields:

- tracked keyword
- product title
- brand when present
- price
- currency
- store/source
- rating
- review count
- search position
- product URL
- image URL
- capture timestamp
- raw payload

Derived records:

- stable product key
- price history
- previous price
- price delta
- price delta percentage

Current insight support:

- price-change insight when a product price changes versus the previous capture for the same product key.

Still missing:

- new product detection insight
- product disappeared / dropped from results insight
- ranking movement insight
- category-level price bands
- store-level competitor summaries

### DataForSEO Labs (organic ranked keywords + keyword gap)

Purpose: independent organic-visibility data source, since GSC access is currently 403/unreliable. Uses DataForSEO's Labs `ranked_keywords` and `domain_intersection` live endpoints. Connector: `lib/connectors/dataforseo-labs.ts`.

This is a metered API — the whole ingestion step in `jobs/fetch-market-intel.ts` is gated behind `DATAFORSEO_LABS_ENABLED=true` (default `false`/unset = skipped entirely, no request is made, no RawSnapshot is written). When enabled, a missing `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` also causes a non-fatal skip (logged, not an error).

Env vars:

- `DATAFORSEO_LABS_ENABLED` — `true` to enable; anything else (including unset) skips the step.
- `DATAFORSEO_LABS_LIMIT` — rows per Labs request, clamped to `(0, 100]`, default `20`.
- `MARKET_INTEL_OWN_DOMAIN` — our domain for ranked-keyword lookups and keyword-gap comparisons, default `agrikoph.com`.

Ranked keywords (own domain):

- Fetches up to `DATAFORSEO_LABS_LIMIT` keywords `MARKET_INTEL_OWN_DOMAIN` ranks for (ordered by search volume).
- Stored as `RawSnapshot` source `dataforseo_ranked`, one row per day (`dateRangeStart === dateRangeEnd`), payload `{ domain, topQueries: [{ keyword, position, searchVolume, cpc, url }] }`.
- Feeds the Task 2 skills `gsc` extra-source fallback chain: `gsc` → `gsc_query_page` → `dataforseo_ranked` (see `lib/skills/extra-context.ts`). The DataForSEO branch has a genuinely different shape (no clicks/impressions — those don't exist in this data) and is marked `source: "dataforseo"` in the returned context so skills know the provenance.

Competitor keyword gap:

- For up to 3 active `Competitor` rows with a usable `domain` (bare host extracted defensively — protocol/path stripped, `www.` dropped; competitors without a usable domain are skipped), runs `domain_intersection` between `MARKET_INTEL_OWN_DOMAIN` and the competitor domain.
- The connector requests the union (`intersections: false`) and filters client-side to rows where the competitor ranks and we don't — the actual "gap" signal.
- Stored as `RawSnapshot` source `dataforseo_keyword_gap`, one row per day, payload `{ ownDomain, competitors: [{ competitorId, competitorName, domain, items }] }`.
- Material gaps (competitor ranks top-10, search volume ≥ 100, we're absent) become `MarketInsight` type `keyword_gap`, capped at 10 per run, deduped against any OPEN `keyword_gap` insight for the same keyword (same pattern as `price_gap` above — open-insight dedup rather than per-day dedup).

Still missing:

- ranking-movement tracking across runs (currently only a point-in-time snapshot)
- own-domain ranked-keyword drop/decline insight
- UI surfacing of `dataforseo_ranked` / `dataforseo_keyword_gap` snapshots

### Keyword Research (DataForSEO)

Purpose: keyword search-volume research only.

Google Ads is not a supported data source (removed 2026-07) — this previously used Google Ads Keyword Planner and has been retargeted to DataForSEO's bulk search-volume API (`lib/connectors/dataforseo-keywords.ts`, `fetchSearchVolume`).

Stored fields:

- seed keyword
- returned keyword
- average monthly searches
- capture timestamp

No longer populated (no DataForSEO equivalent used here):

- competition / competition index
- low/high top-of-page bid micros
- monthly search volume history
- raw payload

Still missing:

- keyword opportunity scoring
- trend detection across captures
- cluster/category rollups
- UI filters for keyword research data
- long-tail keyword-idea discovery and auto-promotion into the active seed list (the previous Google Ads Keyword Planner integration provided this; DataForSEO's bulk search-volume endpoint only returns volume for keywords already supplied, it does not expand or discover new ones — revisit with DataForSEO Labs or a similar vendor if this capability is wanted back)

### Meta Ad Library

Primary long-term source: Meta Ad Library API after access is approved.

Temporary source: Playwright public-page fallback.

Stored fields when available:

- ad archive ID
- page name
- page ID
- ad copy / rendered card text
- headline
- description
- CTA
- landing page URL
- ad snapshot URL
- platforms
- start date
- end date
- active status
- creative type
- image URL
- video URL
- capture timestamp
- raw payload

Important limitation:

Meta Ad Library is creative intelligence, not reliable performance intelligence. It does not expose competitor ROAS, purchases, targeting, or reliable commercial spend data. Ads that have been active for more than 30 days should be treated as a practical signal worth studying, not proof of profitability.

Current insight support:

- new competitor ad insight when a new archive ID is captured
- long-running competitor ad insight when an active ad has a start date at least `MARKET_INTEL_LONG_RUNNING_AD_DAYS` old

Still missing:

- robust creative text parsing
- offer/hook/CTA extraction
- duplicate handling across multiple targets
- screenshot/media capture strategy
- confidence score for scraped fields
- fixture tests for Meta page parser
- formal Meta keyword target model

## Current Target Configuration

There are two kinds of targets:

- product / shopping keywords stored in `MarketKeyword`
- known competitor pages stored in `CompetitorSocialPage`

A provisional `meta_keyword` platform value is supported so the job can use Meta Ad Library keyword searches in addition to known competitor pages. This works, but it is not a clean long-term model. A formal `MarketAdSearchTarget` or similar model would be better if we want keyword-based Meta monitoring as a permanent feature.

Recommended target groups:

- Known competitor Facebook / Instagram pages.
- Product keyword searches for Agriko-relevant categories in the Philippines.
- Brand/product keyword searches for direct competitor products.

High-value Meta rule:

- country: Philippines
- active status: active
- keyword/page relevance: Agriko product niche
- start date: at least 30 days old

## Blocked Until Scheduled Collection Is Safe

Do not enable broad scheduled Market Intelligence collection until these blockers are closed:

- [ ] Safe run profiles exist for smoke, shopping-only, Meta pages, Meta keywords, keyword research, and scheduled runs.
- [ ] Hard per-run and daily caps exist for paid/search sources and Playwright scraping.
- [ ] Meta keyword searches use a formal target model instead of the temporary `meta_keyword` social-page shortcut.
- [ ] `CompetitorAdCapture` exists so repeated discoveries of the same ad preserve every target/run attribution.
- [ ] The Playwright fallback has fixture tests and parser confidence fields.
- [ ] A source-health view shows Meta API denied, scraper blocked, zero-result, partial, and parse-error states.
- [ ] Manual UI triggers cannot accidentally launch broad paid API collection.

Until then, only explicit smoke/manual runs with narrow limits should be used.

## Key Architectural Gaps

### 1. Collection Profiles

Collection limits are currently driven by environment variables:

- `MARKET_INTEL_KEYWORD_LIMIT`
- `MARKET_INTEL_RESULTS_PER_KEYWORD`
- `MARKET_INTEL_COMPETITOR_PAGE_LIMIT`
- `MARKET_INTEL_ADS_PER_PAGE_LIMIT`
- `MARKET_INTEL_META_ACTIVE_STATUS`
- `MARKET_INTEL_LONG_RUNNING_AD_DAYS`

That is not enough for regular operation. We need saved collection profiles or explicit request-level controls so an operator can run:

- smoke test
- shopping-only capture
- Meta known-competitor capture
- Meta keyword capture
- keyword research only
- full scheduled capture

Each profile should define source, target limits, provider, active-only/all status, and whether paid API calls are allowed.

### 2. Cost and Rate Controls

Before scheduling, the module needs hard controls:

- max shopping API calls per run
- max Meta pages/searches per run
- max Playwright browser pages per run
- timeout per source
- daily cap per source
- manual run confirmation when a request exceeds smoke-test limits
- persisted run profile in `JobRun.summary`

This is especially important for paid providers and scraper reliability.

### 3. Target Attribution

`CompetitorAd.adArchiveId` is unique. If the same ad is found through more than one target, the current upsert updates the single ad row and effectively keeps only one current competitor/target attribution.

For proper analysis, add a capture/link table:

- `CompetitorAdCapture`
  - adId
  - jobRunId
  - targetType
  - targetKeyword
  - competitorSocialPageId
  - rank/position if available
  - capturedAt
  - rawSnippet

This preserves which search/page found the ad each time without duplicating the ad itself.

### 4. Formal Meta Search Targets

Using `CompetitorSocialPage.platform = "meta_keyword"` is a practical temporary shortcut. It should become a proper model:

- `MarketAdSearchTarget`
  - label
  - query
  - country
  - activeStatus
  - category
  - active
  - maxAdsPerRun

This separates real competitor pages from keyword searches.

### 5. Analysis Contract

Do not run AI analysis directly over raw scraped dumps. First normalize source data into a stable analysis payload:

- competitor
- target/query
- ad archive ID
- active status
- running days
- detected product/category
- hook
- offer
- CTA
- price/discount language
- landing page host
- creative type
- confidence
- source URL

Only after this normalization should we generate advisory insights.

### 6. Dashboard Maturity

The current dashboard is a functional first pass. It loads recent captures and supports basic config entry. It is not yet an operator-grade intelligence dashboard.

Missing dashboard features:

- filters by source, keyword, competitor, status, and date range
- long-running ad view
- active-only Meta view
- price-change view
- keyword opportunity view
- target management view
- run profile selector
- last run per source
- error/source health panel

## Recommended Data Flow

1. Operator configures Market Keywords and competitor pages.
2. Operator configures Meta search targets for product/category keywords.
3. A run profile determines which sources execute and what limits apply.
4. The job creates one `JobRun`.
5. Shopping collection stores `ShoppingResult` and `ShoppingPriceHistory`.
6. Meta collection stores `CompetitorAd` and capture-target links.
7. Keyword research stores `KeywordResearchResult`.
8. Deterministic detectors create `MarketInsight` rows:
   - price change
   - new product
   - rank movement
   - new ad
   - long-running active ad
   - recurring offer/hook
9. AI analysis reads normalized, bounded recent data and creates advisory insights only.
10. Operator can send an insight to planning, but no external mutation occurs.

## Storage, Visualization, Analysis, and Action Model

Market Intelligence should not be treated as one table of scraped results. It needs separate concepts for targets, observations, signals, insights, and actions.

### Storage

Use separate layers:

- Targets:
  - shopping keywords
  - competitor social pages
  - Meta keyword/ad search targets
- Observations:
  - shopping search result captures
  - product price observations
  - product rank observations
  - Meta ad captures
  - keyword research captures
- Stable entities:
  - competitor
  - competitor ad
  - normalized product identity
  - market keyword
- Signals:
  - deterministic changes found from observations
- Insights:
  - human-readable explanation and recommended next step

Key storage rule:

- Stable entities should be upserted.
- Observations should be appended.
- Signals should be reproducible.
- Insights should link back to evidence.

Immediate schema improvement:

- Add `CompetitorAdCapture`.
  - `CompetitorAd` should represent the ad identity.
  - `CompetitorAdCapture` should represent each time a target/run found that ad.
  - This prevents one ad found by multiple searches from losing attribution.

Recommended `CompetitorAdCapture` fields:

- `adId`
- `jobRunId`
- `competitorSocialPageId`
- `marketAdSearchTargetId`
- `targetType`
- `targetQuery`
- `capturedAt`
- `position`
- `source`
- `parserConfidence`
- `rawSnippet`

Recommended `MarketAdSearchTarget` fields:

- `label`
- `query`
- `country`
- `activeStatus`
- `category`
- `maxAdsPerRun`
- `active`

### Visualization

The dashboard should be organized by decisions, not database tables.

Required views:

- Overview:
  - long-running active ads
  - new ads
  - material price changes
  - keyword opportunities
  - last run/source health
- Meta Ads:
  - active ads
  - ads running 30+ days
  - new ads by competitor/query
  - hooks/offers/CTAs
  - landing page URLs
- Shopping:
  - current SERP by keyword
  - price history
  - rank movement
  - store comparison
  - new/disappeared products
- Keyword Research:
  - volume
  - competition
  - bid ranges
  - trend over captures
- Targets:
  - keywords
  - competitor pages
  - Meta search targets
  - per-target caps
- Runs/Health:
  - last success/failure by source
  - source errors
  - usage/cap summary

Important filters:

- source
- keyword
- category
- competitor
- target type
- active status
- date range
- severity
- insight status

### Analysis

Analysis should happen in two passes.

Deterministic analysis:

- price changed
- price crossed threshold
- product entered top results
- product disappeared
- rank improved/dropped
- new ad found
- active ad older than 30 days
- repeated offer/hook detected
- keyword opportunity found

AI-assisted analysis:

- summarize competitor positioning
- identify repeated hooks
- compare offers and pricing themes
- suggest ad angles to test
- suggest product/content opportunities
- highlight risks in Agriko positioning

AI rules:

- use normalized recent data only
- include evidence references
- include confidence
- never claim competitor ROAS, purchases, targeting, or exact performance
- treat long-running ads as a proxy for importance, not proof of profitability

### Acting on Insights

Market Intelligence should be advisory first.

Allowed actions:

- mark insight resolved
- ignore insight
- add/edit target
- create Content Pilot proposal
- create planning note
- create reviewable Ad Pilot recommendation only if action is supported

Not allowed in first release:

- directly change ad budgets
- directly launch ads
- directly edit Shopify products/content
- directly send email/social campaigns

The action path should be:

1. source capture
2. deterministic signal
3. advisory insight
4. operator review
5. optional handoff to Content Pilot or Ad Pilot
6. dry-run if executable
7. reviewed execution only for supported actions

## Implementation Plan

### Phase 1: Freeze and Document Current Wiring

- [x] Confirm schema, connectors, jobs, API routes, and UI exist.
- [x] Confirm Google Shopping capture works through the Serper connector.
- [x] Confirm Google Ads keyword research path is keyword-only.
- [x] Confirm Meta Ad Library API path is wired and falls back to Playwright when access is blocked.
- [x] Confirm Playwright can capture public Meta Ad Library cards on the live Linode server.
  - Verified on June 19, 2026 with a constrained direct scraper smoke test and a constrained `fetch-market-intel` job run.
  - This does not mean broad scraping is approved; scheduled collection is still blocked until run profiles, caps, target attribution, and parser tests exist.
- [ ] Document source limitations directly in the UI.
- [x] Add the new Market Intelligence variables to `.env.example`.

### Phase 2: Add Safe Run Profiles

- [ ] Add a typed run-options object for `fetchMarketIntelHandler`.
- [ ] Let manual routes pass explicit safe limits instead of relying only on environment variables.
- [ ] Add profiles:
  - `smoke`
  - `shopping`
  - `meta-pages`
  - `meta-keywords`
  - `keyword-research`
  - `scheduled`
- [ ] Store the chosen profile and resolved limits in `JobRun.summary`.
- [ ] Add hard caps so manual UI clicks cannot accidentally run broad paid collection.

### Phase 3: Fix Target Modeling

- [ ] Add a formal Meta keyword/search target model.
- [ ] Migrate provisional `meta_keyword` rows into that model.
- [ ] Keep competitor social pages strictly for real Facebook/Instagram pages.
- [ ] Add UI for target type:
  - competitor page
  - product keyword
  - brand keyword
  - category keyword

### Phase 4: Add Capture Attribution

- [ ] Add `CompetitorAdCapture`.
- [ ] Link each ad capture to the run and target that found it.
- [ ] Preserve multiple target matches for the same archive ID.
- [ ] Use the capture table for dashboards and analysis instead of relying only on the ad row.

### Phase 5: Harden Meta Collection

- [ ] Keep Meta API as the preferred source once access is approved.
- [ ] Keep Playwright as temporary fallback.
- [ ] Add fixture tests for the scraper parser using saved public-page HTML.
- [ ] Add parser confidence fields.
- [ ] Parse active status, start/end date, page name, ad copy, CTA, landing URL, and media URL separately where possible.
- [ ] Skip or flag cards where fields are low-confidence.
- [ ] Add source health reporting for API denied, scraper blocked, zero results, and parse errors.

### Phase 6: Complete Deterministic Insights

- [ ] Shopping:
  - price changes
  - new products
  - disappeared products
  - rank movement
  - store price bands
- [ ] Meta:
  - new ad
  - active ad older than 30 days
  - repeated offer/hook
  - new landing page/product pushed by competitor
- [ ] Keyword research:
  - high-volume / low-competition opportunities
  - rising search interest
  - content topic suggestions

### Phase 7: Build the Intelligence Dashboard

- [ ] Add filters and tabs:
  - Overview
  - Shopping
  - Meta Ads
  - Keyword Research
  - Insights
  - Targets
  - Runs / Health
- [ ] Add long-running active Meta ads as a first-class table.
- [ ] Show running days and source confidence.
- [ ] Show price history and rank history for tracked products.
- [ ] Show keyword demand and competition summary.
- [ ] Add operator actions:
  - mark insight resolved
  - ignore target
  - add target from result
  - send advisory note to planning queue

### Phase 8: Add AI Analysis

- [ ] Add a bounded analysis endpoint.
- [ ] Feed it normalized recent data only.
- [ ] Require source/citation references in generated insights.
- [ ] Output advisory `MarketInsight` rows.
- [ ] Do not create executable ad recommendations in this release.

### Phase 9: Schedule and Monitor

- [ ] Add scheduled source-specific runs.
- [ ] Add stale-run alerts for Market Intelligence.
- [ ] Add failure/partial-run alerts.
- [ ] Add daily cap reporting for paid/search sources.
- [ ] Add an operations note for pausing Market Intelligence collection.

## Acceptance Gate

The module is ready for regular use when all of these pass:

- [ ] A smoke run can execute with one shopping keyword and one Meta target.
- [ ] A shopping run stores products and price history without inline image blobs.
- [ ] A keyword research run stores DataForSEO keyword search-volume metrics.
- [ ] A Meta page run stores competitor ads.
- [ ] A Meta keyword run stores active Philippines niche ads.
- [ ] An active Meta ad older than 30 days creates a long-running-ad insight.
- [ ] Duplicate archive IDs preserve all target matches through capture attribution.
- [ ] Price changes create insights.
- [ ] Rank movement creates insights.
- [ ] Dashboard filters by source, competitor, keyword, status, and date.
- [ ] Run profiles prevent accidental broad paid API usage.
- [ ] Failed or partial runs are visible in the UI.
- [ ] No scheduled collection is enabled until source caps and run profiles are in place.

## Current Bottom Line

The plumbing is mostly wired. The module is not ready to be treated as finished intelligence yet.

What is real now:

- storage
- basic collection
- manual/cron entry points
- first-pass UI
- Shopping capture
- keyword research capture
- Meta API/fallback connector
- first deterministic insights

What still needs planning-grade completion:

- safe run profiles
- formal target modeling
- capture attribution
- cost/rate caps
- robust Meta parser tests
- dashboard filters
- deterministic insight expansion
- bounded AI analysis
- operational monitoring
