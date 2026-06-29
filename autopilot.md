# Agriko Autopilot — Technical Write-Up

**Root:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/`

> **Current state (updated 2026-06-16):** The safety milestone is complete. All API routes are authenticated. Execution is decoupled from approval and runs in a separate cron job with locking, before-state capture, guardrail re-check, and audit logging. Meta mutations use POST with form-encoded body. Hard-block overrides require written justification and go directly to `override_approved` in a single operator action. The app can be deployed and is safe for supervised live ad-account writes. ApiCredential CRUD is fully wired with AES-256-GCM encryption. Google Ads connector is now implemented (previously disabled). JWT sub decoded to real Shopify user identity on all override/approval routes. Unused Session model and its package removed. Email, Social, and SEO Pilots have AI analysis endpoints and UI panels. Content Pilot has topic cluster gaps DataTable and orphan/hub article panels. Test coverage added for crypto, guardrails, and skills runner.

---

## What It Is

Agriko Autopilot (`agriko-autopilot`) is a Shopify embedded app designed to act as an AI-powered marketing operations layer for Agriko. It ingests ad performance data from Meta, generates actionable recommendations via AI, enforces safety guardrails, and supports human-reviewed execution of changes — all from within the Shopify admin.

---

## Architecture

**Stack:** Next.js 14 (App Router) · PostgreSQL local (`localhost:5432/autopilot`, via Prisma) · Shopify App Bridge · OpenAI-compatible API (OpenRouter)

Defined in:
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/package.json` — dependencies, scripts
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/next.config.js` — Next.js config
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/server.js` — custom server entry point
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/railway.toml` — legacy, no longer used
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/.env.local` — live credentials
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/.env.example` — credential template

---

## Intended Core Loop

```
1. Data Fetch Jobs [WORKING]   → pull raw snapshots from Meta (Google Ads implemented; returns empty data without credentials)
2. Skills Runner   [WORKING]   → AI analyses snapshot including insights (ROAS/CTR/spend/frequency)
3. Guardrails      [WORKING]   → safety rules derived from snapshot data, not AI-provided fields
4. Review Queue    [WORKING]   → approve / reject / override-hard-block all wired;
                               single-owner override: one action + justification → override_approved
5. Execution       [WORKING]   → separate cron job; idempotency lock; before-state capture;
                               guardrail re-check; stuck-lock recovery with audit trail;
                               override_approved skips re-check (already reviewed)
6. Audit Log       [WORKING]   → all terminal state transitions logged with before/after state
```

---

## Database Schema

**File:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/prisma/schema.prisma`
**Migrations:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/prisma/migrations/`
**Seed:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/prisma/seed.ts`

Seven models (Session removed):

| Model | Status | Purpose |
|---|---|---|
| `RawSnapshot` | Working | Raw JSON payloads from each platform connector, timestamped |
| `Recommendation` | Working | AI-generated action items with full lifecycle: create → guard → review → execute |
| `AuditLog` | Working | Full execution lifecycle: started / blocked / success / failed / timeout-recovered |
| `JobRun` | Working | Tracks scheduled job executions (start, end, status, summary) |
| `ApiCredential` | Working | AES-256-GCM encrypted platform API keys — full CRUD via `/api/settings/credentials` |
| `GuardrailConfig` | Working | Configurable safety thresholds, seeded on first GET to `/api/settings` |
| `ArticleRecord` | Working | Blog article index: slug, title, html hash, SEO score, link counts, topic tags, sessions |

### Recommendation status lifecycle

```
pending → approved → executing → executed
                              ↘ failed
       → override_approved → executing → executed
                                        ↘ failed
       → rejected
```

---

## Data Connectors

**Directory:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/connectors/`

| File | Platform | Status | Notes |
|---|---|---|---|
| `meta.ts` | Meta Ads | Working (read + write) | Fetches campaigns, ad sets, ads, insights. Mutations use POST with `application/x-www-form-urlencoded` body and `Authorization: Bearer` header. |
| `google-ads.ts` | Google Ads | Implemented (disabled without credentials) | Full implementation using `google-ads-api@24.1.0`. Returns empty data if `GOOGLE_ADS_*` env vars are absent. |
| `ga4.ts` | Google Analytics 4 | Active | Connector pulls page sessions into snapshots |
| `gsc.ts` | Google Search Console | Active | Connector pulls search queries and clicks |
| `klaviyo.ts` | Klaviyo | Conditional | Returns `configured: false` if `KLAVIYO_API_KEY` not set |
| `meta-organic.ts` | Meta Organic | Active | Pulls managed page posts for social-pilot |

Supporting files:
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/shopify.ts` — lazy-initialised Shopify API + `verifySessionToken` + `decodeSessionUser()` (decodes JWT `sub` to real Shopify user identity)
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/shopify-admin.ts` — Admin API helpers using permanent token
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/auth.ts` — `requireAppAuth` (App Bridge JWT) + `requireCronAuth` (CRON_SECRET) + `getSessionUser()` (actor identity for audit logs)
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/db.ts` — Prisma client singleton
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/crypto.ts` — AES-256-GCM encrypt/decrypt for ApiCredential values

---

## Auth Model

**File:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/auth.ts`

Three guards, used on every route:

| Guard | Used on | Mechanism |
|---|---|---|
| `requireAppAuth(req)` | All embedded API routes | Verifies App Bridge session token via `shopify.session.decodeSessionToken` |
| `requireCronAuth(req)` | All cron routes | Checks `Authorization: Bearer $CRON_SECRET`; fails closed in production if secret not set |
| `getSessionUser(req)` | Recommendation action routes | Decodes JWT `sub` via `decodeSessionUser()` → real Shopify user identity; falls back to `"operator"` on failure |

**Frontend:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/hooks/use-auth-fetch.ts` — `useAuthFetch()` hook that wraps every API call from embedded pages with the session token and correct `Content-Type` (JSON only when body is present, preserving caller-supplied headers).

---

## Skills System

**Skills source directory:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/skills-source/`

Skills are Markdown files with YAML frontmatter defining one analysis capability per file.

**Skills infrastructure:**
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/skills/loader.ts` — reads all `.md` files from `skills-source/`, parses frontmatter, deduplicates (root-level files win over subdirectory copies), caches in memory
- `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/skills/runner.ts` — sends each skill's prompt + snapshot payload to Claude (via OpenRouter), parses structured `recommendations` JSON blocks, validates with Zod. Payload includes: campaigns, adSets, ads, keywords, searchTerms, **and insights** (ROAS, CTR, spend, frequency, CPC).

The AI must return recommendations in one of five action types:
- `pause_campaign` / `pause_ad`
- `adjust_budget` (proposedValue must be a plain PHP number)
- `change_bid`
- `add_negative_keyword`

---

## Guardrails

**File:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/lib/guardrails.ts`

Every recommendation is scored before entering the queue. Thresholds are read from `GuardrailConfig`.

| Rule | Default | Effect |
|---|---|---|
| Bid change % | > 50% | Hard block |
| Budget change % | > 200% | Hard block |
| Conversion count | < 10 | Hard block |
| Pause spend | > ₱10,000/day | Hard block |
| Any change % | > 30% | Soft flag |
| Pause spend | > ₱200/day | Soft flag |
| Confidence score | < 50% | Soft flag |

**Guardrail inputs** (`conversionCount`, `dailyBudgetPhp`) are derived deterministically from the linked `RawSnapshot` by `execute-approved.ts:deriveGuardrailInputs()` — not trusted from AI-provided fields.

Hard-blocked recommendations are saved with `guardStatus: "hard_block"` and require an explicit override with written justification before the executor will run them.

---

## Hard-Block Override Flow

Single-owner model — one operator, one step.

1. Operator sees hard-blocked rec in the "Pending" tab
2. Clicks **Override Hard Block** → prompt requires written justification (≥10 chars)
3. `POST /api/recommendations/[id]/request-override` → sets `status: "override_approved"` directly, writes audit log with justification
4. Executor cron picks up `override_approved` recs and executes them — guardrail re-check is skipped (operator already reviewed)

The `/api/recommendations/[id]/override-approve` route has been deleted — it served the retired two-person flow.

---

## Background Jobs

**Directory:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/jobs/`

| File | Status | What It Does |
|---|---|---|
| `fetch-ads-data.ts` | Working (Meta only) | Pulls Meta snapshots into `RawSnapshot`; Google Ads returns empty |
| `fetch-seo-data.ts` | Working | Pulls GSC and GA4 snapshots |
| `run-skills.ts` | Working | Loads snapshots, runs all enabled skills, writes recommendations |
| `execute-approved.ts` | Working | Recovers stuck locks → re-checks guardrails (skipped for override_approved) → captures before-state → executes → full audit trail |
| `fetch-blog-content.ts` | Working | Fetches all blog articles from Shopify Admin API, SHA-256 hashes HTML to skip unchanged articles, runs analyzers, computes inbound link counts, writes `ArticleRecord` rows |

**Stuck lock recovery:** At the start of each executor run, any rec stuck in `"executing"` for >10 minutes (process died mid-run) is reset to `"failed"` with an individual `execution_timeout_recovered` audit log entry per rec.

---

## Content Pilot Subsystem

A blog article indexer and analyzer pipeline — separate from the ad-pilot recommendation loop.

**Data model:** `ArticleRecord` — fields: `id`, `shopifyId`, `handle`, `title`, `publishedAt`, `contentHash`, `wordCount`, `seoData` (Json), `linksData` (Json), `topicsData` (Json), `indexedAt`, `updatedAt`. SEO scores, link lists, and topic classifications are stored as JSON blobs in their respective fields, not as scalar columns. No version/snapshot history — content changes overwrite in place.

**Ingest job:** `jobs/fetch-blog-content.ts`
- Fetches articles from Shopify Admin API via `lib/shopify-admin.ts` (paginated, MAX_PAGES=50)
- SHA-256 hashes article HTML — skips re-processing unchanged articles
- Computes inbound link counts (`computeInboundCounts()`) — counts how many other articles link to each article by scanning `/blogs/<handle>/` paths

**Analyzers** (`lib/analyzers/`):

| File | What It Does |
|---|---|
| `html-parser.ts` | Strips HTML tags, extracts plain text content |
| `blog-seo.ts` | Scores article SEO (title length, word count, h1 presence, meta description) + issue list |
| `blog-links.ts` | Extracts internal (`/blogs/…`) and external links |
| `blog-topics.ts` | Classifies article into topic clusters (from `lib/config/topic-clusters.ts`) with confidence score |

**API routes (Content Pilot UI):**

| Route | Description |
|---|---|
| `GET /api/content-pilot/` | Blog article list with GA4 traffic |
| `GET /api/content-pilot/articles/` | Paginated `ArticleRecord` list with SEO scores, link counts, topic tags |
| `GET /api/content-pilot/articles/[slug]/` | Single article detail |
| `POST /api/content-pilot/brief/` | Generate AI content brief via OpenRouter |
| `GET /api/content-pilot/topic-clusters/` | Topic cluster summary with article counts and gap analysis |
| `GET /api/content-pilot/link-graph/` | Internal link graph data (nodes + edges) |
| `POST /api/content-pilot/index/` | Manually trigger article re-index |

---

## Competitor Intelligence (Scraper)

A separate Python project at `../scraper/` crawls and indexes Ryze's blog corpus (~1,097 articles) into a local SQLite DB (`data/index/ryze.db`) and exposes a **FastMCP server** (`mcp_server/server.py`) with 27 tools covering content search, topic clusters, link graph, positioning analysis, workflow extraction, CTA patterns, and mock marketing data (Google Ads, Meta, GSC, SEO audits).

The scraper is a **research and planning tool** — it is not a runtime dependency of autopilot-app and does not share a database with it. However, Claude in autopilot-app could be connected to the scraper's MCP server to query competitor intelligence during skill runs or content briefs. This integration does not currently exist.

**Topic taxonomy note:** The scraper uses a Ryze-domain topic taxonomy (MCP, Claude, Meta Ads, Google Ads, SEO, Automation, Shopify, etc.). autopilot-app's `blog-topics.ts` analyzer uses a separate Agriko-domain taxonomy defined in `lib/config/topic-clusters.ts` (organic-farming, rice, moringa, ginger, herbal-health, nutrition, cooking, philippine-culture). These are intentionally different systems applied to different corpora.

**CTA pattern note:** Both systems define `CTA_PATTERNS` independently (`scraper/config.py` for Ryze CTAs, `autopilot-app/lib/config/topic-clusters.ts` for Agriko CTAs). There is no shared contract — coincidental overlap terms like "learn more" are independent.

---

## Rate Limiting

**File:** `lib/rate-limit.ts`

Applied to AI analysis endpoints: `/api/email-pilot/analyze`, `/api/seo/analyze`, `/api/seo/brief`, `/api/social-pilot/analyze`, `/api/images`, `/api/content-pilot/brief`.

> **Limitation:** Uses an in-process `Map` — resets on server restart. Provides burst protection within a single running instance only. Upgrade path: Redis for distributed rate limiting.

---

## Skills System — Details

**Infrastructure:** `lib/skills/loader.ts` + `lib/skills/runner.ts`

- **`AGRIKO_CONTEXT`** — a brand/business system prompt injected into every skill call (defined in `runner.ts`). Tells the AI about Agriko's context, objectives, and constraints.
- **`OUTPUT_REMINDER`** — appended to every user prompt, enforcing the `{"recommendations": [...]}` JSON output schema. The AI must return this exact structure; `runner.ts` validates with Zod.
- **Platform filtering** — skills declare a `platform` in frontmatter (`meta`, `google_ads`, `both`, `seo`, `linkedin`, `reddit`). Skills with `linkedin`, `reddit`, or `seo` platforms load successfully but are never dispatched — logged as warnings at startup.
- **Deduplication** — root-level `skills-source/` files win over identically-named files in subdirectories. Allows canonical overrides without deleting subdirectory copies.

---

## Operational Notes

**CRON_SECRET fails closed:** `requireCronAuth` in `lib/auth.ts` returns 401 for all requests if `CRON_SECRET` is not set in production. All 6 background jobs will silently fail at cron time if this env var is missing.

**Guardrail re-check at execution:** `execute-approved.ts` re-validates approved recommendations against guardrails immediately before execution using `deriveGuardrailInputs()`, which re-derives `conversionCount` and `dailyBudgetPhp` from the linked `RawSnapshot` — not from AI-provided fields. `override_approved` recs skip this re-check (operator already reviewed).

**Meta API pagination limits:** `lib/connectors/meta.ts` uses single-page fetches (no cursor follow-through). Accounts with >100 campaigns, >200 ad sets, or >500 insight rows will be **silently truncated**. Planned fix: add `paging.next` cursor loop.

---

## API Routes

**Directory:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app/api/`

| Route | Methods | Auth | Notes |
|---|---|---|---|
| `auth/[...shopify]/` | GET | — | Shopify auth stub (private app model) |
| `health/` | GET | — | Public health check |
| `campaigns/` | GET | App Bridge | Reads from latest snapshot |
| `recommendations/` | GET | App Bridge | List, paginated, filterable by status |
| `recommendations/[id]/approve/` | POST | App Bridge | Sets `status: "approved"` only — actor identity from JWT sub |
| `recommendations/[id]/reject/` | POST | App Bridge | Rejects with optional note — actor identity from JWT sub |
| `recommendations/[id]/request-override/` | POST | App Bridge | Overrides hard block with justification → sets `status: "override_approved"` directly — actor identity from JWT sub |
| `audit-log/` | GET | App Bridge | Recent activity feed |
| `content-pilot/` | GET | App Bridge | Blog article list with GA4 traffic |
| `content-pilot/brief/` | POST | App Bridge | AI content brief (spends OpenRouter tokens) |
| `email-pilot/` | GET | App Bridge | Klaviyo campaign data |
| `email-pilot/analyze/` | POST | App Bridge | AI analysis of email campaign performance |
| `images/` | GET, POST | App Bridge | Image list + AI alt text generation |
| `jobs/status/` | GET | App Bridge | Pending count, executed count, last run |
| `jobs/trigger/` | POST | App Bridge | Manual full pipeline trigger |
| `settings/` | GET, PUT | App Bridge | Guardrail config read/write |
| `settings/credentials/` | GET, POST | App Bridge | List ApiCredential keys; create new encrypted credential |
| `settings/credentials/[key]/` | GET, PUT, DELETE | App Bridge | Read, update, or delete a single ApiCredential |
| `seo/` | GET | App Bridge | GSC + GA4 aggregated data |
| `seo/analyze/` | POST | App Bridge | AI content gap analysis across GSC + GA4 data |
| `seo/brief/` | POST | App Bridge | AI SEO brief (spends OpenRouter tokens) |
| `social-pilot/` | GET | App Bridge | Meta organic page posts |
| `social-pilot/analyze/` | POST | App Bridge | AI analysis of social post performance |
| `content-pilot/articles/` | GET | App Bridge | Paginated `ArticleRecord` list with SEO scores, link counts, topic tags |
| `content-pilot/articles/[slug]/` | GET | App Bridge | Single article detail |
| `content-pilot/topic-clusters/` | GET | App Bridge | Topic cluster summary with article counts |
| `content-pilot/link-graph/` | GET | App Bridge | Internal link graph (nodes + edges) |
| `content-pilot/index/` | POST | App Bridge | Manually trigger article re-index |
| `cron/daily/` | GET | CRON_SECRET | Full pipeline: fetch → skills → (executor runs separately) |
| `cron/execute-approved/` | GET | CRON_SECRET | Execute approved/override_approved recs |
| `cron/fetch-ads-data/` | GET | CRON_SECRET | Fetch Meta snapshot |
| `cron/fetch-blog-content/` | GET | CRON_SECRET | Fetch and index all Shopify blog articles |
| `cron/fetch-seo-data/` | GET | CRON_SECRET | Fetch GSC + GA4 snapshot |
| `cron/run-skills/` | GET | CRON_SECRET | Run all enabled skills |
| `cron/status/` | GET | CRON_SECRET | Pipeline status check |

---

## Embedded App UI

**Directory:** `/mnt/c/Users/Sean/Documents/Agriko/autopilot-app/app/(embedded)/`

All pages use `useAuthFetch()` — no unprotected `fetch()` calls remain.

| Page | Status |
|---|---|
| Dashboard | Working — pending/executed counts, last job run, recent audit log, manual trigger |
| Ad Pilot | Working — campaign table with metrics, recommendation queue with approve/reject/override |
| Campaigns | Working — platform-tabbed campaign list |
| Recommendations | Working — tabbed by status (pending/override_approved/executed/failed/rejected); single-owner override UI |
| SEO Pilot | Working — GSC + GA4 data; AI content gap analysis panel |
| Content Pilot | Working — topic cluster gaps DataTable; orphan/hub article side-by-side panels; link graph data |
| Email Pilot | Working — Klaviyo campaign data; AI Insights panel |
| Social Pilot | Working — Meta organic posts; AI Insights panel |
| Store Pilot | Working — image alt text coverage overview |
| Images | Working — per-image AI alt text generation (generate-only; no direct Shopify writes) |
| Insights | Working — cross-pilot health summary |
| Settings | Working — guardrail threshold config; Credentials UI (list keys, delete, add new with AES-256-GCM encryption) |

---

## Known Remaining Gaps

| # | Severity | Issue | File |
|---|---|---|---|
| 1 | Low | Meta form-encoded POST is correct per API spec but untested against live mutations — will surface on first real pause/budget call | `lib/connectors/meta.ts` |
| 2 | Low | Google Ads connector implemented but not yet connected to live credentials — `GOOGLE_ADS_*` env vars required | `lib/connectors/google-ads.ts` |

### Recently Resolved
| # | Was | Resolution |
|---|---|---|
| 1 | Override actor defaulted to `"operator"` string | `decodeSessionUser()` added to `lib/shopify.ts`; `getSessionUser()` wired in `lib/auth.ts`; all 3 recommendation routes updated |
| 2 | Google Ads disabled — connector returned empty | Full implementation added using `google-ads-api@24.1.0` |
| 3 | `Session` model and `@shopify/shopify-app-session-storage-prisma` unused | Removed from schema; package uninstalled |
| 4 | `ApiCredential` table existed but nothing read/wrote it | Full CRUD at `/api/settings/credentials` with AES-256-GCM encryption in `lib/crypto.ts` |

---

## Deployment

- **Database:** Local PostgreSQL (`localhost:5432/autopilot`) via Prisma — `DATABASE_URL` set in `.env`
- **AI inference:** OpenRouter (`openrouter.ai/api/v1`) defaulting to `anthropic/claude-sonnet-4-6`, overridable via `OPENROUTER_MODEL`
- **Shopify:** Private app, permanent admin token — no `shopify.app.toml`, no OAuth flow
- **Cron:** 6 independent routes scheduled 01:00–06:00 UTC by an external scheduler calling the `/api/cron/*` routes with `Authorization: Bearer $CRON_SECRET`. See `docs/CRON.md`.

---

## Complete File Index

### Config & Root
```
.env.example                          Credential template (OPENROUTER_API_KEY, CRON_SECRET, META_*, SHOPIFY_*)
.env.local                            Live credentials (gitignored)
next.config.js                        Next.js config
package.json                          Dependencies and scripts
railway.toml                          Legacy deployment config (unused)
server.js                             Custom server entry point (no scheduler import)
tsconfig.json
autopilot.md                          This document
```

### App — Pages
```
app/layout.tsx
app/providers.tsx                                          Shopify App Bridge + Polaris providers
app/(embedded)/layout.tsx
app/(embedded)/page.tsx                                    Dashboard
app/(embedded)/settings/page.tsx                           Guardrail config UI
app/(embedded)/(ad-pilot)/ad-pilot/page.tsx
app/(embedded)/(ad-pilot)/campaigns/page.tsx
app/(embedded)/(ad-pilot)/recommendations/page.tsx
app/(embedded)/(content-pilot)/content-pilot/page.tsx
app/(embedded)/(email-pilot)/email-pilot/page.tsx
app/(embedded)/(insights)/insights/page.tsx
app/(embedded)/(seo-pillar)/seo-pillar/page.tsx
app/(embedded)/(seo-pillar)/seo/page.tsx
app/(embedded)/(social-pilot)/social-pilot/page.tsx
app/(embedded)/(store-pilot)/images/page.tsx
app/(embedded)/(store-pilot)/store-pilot/page.tsx
```

### App — API Routes
```
app/api/auth/[...shopify]/route.ts
app/api/audit-log/route.ts
app/api/campaigns/route.ts
app/api/content-pilot/route.ts
app/api/content-pilot/articles/route.ts
app/api/content-pilot/articles/[slug]/route.ts
app/api/content-pilot/brief/route.ts
app/api/content-pilot/index/route.ts
app/api/content-pilot/link-graph/route.ts
app/api/content-pilot/topic-clusters/route.ts
app/api/cron/daily/route.ts
app/api/cron/execute-approved/route.ts
app/api/cron/fetch-ads-data/route.ts
app/api/cron/fetch-blog-content/route.ts
app/api/cron/fetch-seo-data/route.ts
app/api/cron/run-skills/route.ts
app/api/cron/status/route.ts
app/api/email-pilot/route.ts
app/api/email-pilot/analyze/route.ts        AI email campaign analysis
app/api/health/route.ts
app/api/images/route.ts
app/api/jobs/status/route.ts
app/api/jobs/trigger/route.ts
app/api/recommendations/route.ts
app/api/recommendations/[id]/approve/route.ts
app/api/recommendations/[id]/reject/route.ts
app/api/recommendations/[id]/request-override/route.ts
app/api/seo/route.ts
app/api/seo/analyze/route.ts               AI content gap analysis
app/api/seo/brief/route.ts
app/api/settings/route.ts
app/api/settings/credentials/route.ts      GET list + POST create ApiCredential
app/api/settings/credentials/[key]/route.ts  GET + PUT + DELETE single credential
app/api/social-pilot/route.ts
app/api/social-pilot/analyze/route.ts      AI social performance analysis
```

### Hooks
```
hooks/use-auth-fetch.ts     Authenticated fetch for all embedded pages (App Bridge session token)
```

### Jobs
```
jobs/fetch-ads-data.ts
jobs/fetch-blog-content.ts  SHA-256 dedup · Shopify Admin article fetch · analyzers · inbound link counts
jobs/fetch-seo-data.ts
jobs/run-skills.ts
jobs/execute-approved.ts    Idempotency lock · before-state · guardrail re-check · audit trail · stuck-lock recovery
```

### Lib
```
lib/analyzers/blog-links.ts     Extracts internal (/blogs/…) and external links from article HTML
lib/analyzers/blog-seo.ts      SEO score + issue list (title length, word count, h1, meta)
lib/analyzers/blog-topics.ts   Classifies article into topic clusters with confidence score
lib/analyzers/html-parser.ts   Strips HTML tags, extracts plain text
lib/auth.ts                 requireAppAuth + requireCronAuth + getSessionUser (JWT sub → actor identity)
lib/connectors/ga4.ts
lib/connectors/google-ads.ts   google-ads-api@24.1.0 implementation (credentials required)
lib/connectors/gsc.ts
lib/connectors/klaviyo.ts
lib/connectors/meta-organic.ts
lib/connectors/meta.ts      graphGet (GET + Bearer header) · graphPost (POST + form-encoded)
lib/crypto.ts               AES-256-GCM encrypt/decrypt for ApiCredential values
lib/db.ts
lib/executor.ts
lib/guardrails.ts
lib/rate-limit.ts           In-process burst limiter (Map-based; resets on cold start — see Operational Notes)
lib/scheduler.ts            Deprecated — not imported
lib/shopify-admin.ts        Shopify Admin API helpers: paginated article fetch (MAX_PAGES=50), product image fetch
lib/validate-env.ts         Validates required env vars at startup; throws if any are missing
lib/shopify.ts              Lazy-init · verifySessionToken · decodeSessionUser()
lib/skills/loader.ts
lib/skills/runner.ts        Includes insights in prompt payload
```

### Prisma
```
prisma/schema.prisma        7 models (Session removed)
prisma/seed.ts
prisma/migrations/          Init migration + subsequent migrations
```

### Tests
```
__tests__/lib/crypto.test.ts            5 tests: round-trip, random IV, tamper detection, missing key guard
__tests__/lib/guardrails.test.ts        8 tests with Prisma mock
__tests__/lib/skills/runner.test.ts     9 tests
```

### Skills Source
```
skills-source/              44 skill files across ad-pilot, content-pilot, email-pilot,
                            insights-pilot, seo-pillar subdirectories + root canonical copies
```
