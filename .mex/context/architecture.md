---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
  - target: context/data-pipeline.md
    condition: when working on data ingestion, connectors, snapshots, or job handlers
  - target: context/skills-recommendations.md
    condition: when working on the AI skill system, guardrails, or recommendation lifecycle
  - target: context/conventions.md
    condition: when writing new code that must follow system-level patterns
  - target: patterns/add-api-route.md
    condition: when adding a new route to the system
  - target: patterns/add-cron-job.md
    condition: when adding a new job handler to the pipeline
last_updated: 2026-07-10
---

# Architecture

## System Overview

**Data ingestion path (cron-driven):**
External cron scheduler → `POST /api/cron/*` (Bearer `CRON_SECRET`) → `acquireJobLock` → job handler in `jobs/` → connector in `lib/connectors/` fetches data from Meta/GSC/GA4/Google Ads/Shopify → upserted as `RawSnapshot` rows in PostgreSQL → `run-skills` job loads `skills-source/*.md` prompts + sends snapshot payload to DeepSeek → parsed `Recommendation` rows written to DB.

**Operator review + execution path:**
Shopify admin iframe → Next.js App Router page (`app/(embedded)/`) → App Bridge session token → embedded API route (`app/api/`) → Prisma query → operator approves recommendation → `execute-approved` cron (only when `EXECUTE_APPROVED_LIVE_ENABLED=true`) → `lib/guardrails.ts` re-checks → live write to Meta Ads API or Shopify Admin API.

**Browser auth:** Embedded browser requests use Shopify App Bridge JWT bearer tokens; browser code must never receive or send `AUTOPILOT_API_KEY`. Embedded app routes call `requireAppAuth(req)` to validate the JWT. When the embedded app and Admin API token-refresh app differ, session verification uses `SHOPIFY_SESSION_API_KEY` / `SHOPIFY_SESSION_API_SECRET` while the Admin connector retains `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. Trusted direct/scripted calls may use the server-only `X-Autopilot-Api-Key` header.

## Key Components

- **`jobs/`** — standalone job handler functions; each exports a `[name]Handler()` called by cron routes; writes a `JobRun` row and returns `JobResult<T>`
- **`lib/skills/`** — AI skill system: `loader.ts` reads `skills-source/*.md`, `runner.ts` calls DeepSeek, `orchestrator.ts` coordinates multi-skill runs and deduplicates recommendations
- **`lib/connectors/`** — per-platform data fetchers: `meta.ts`, `ga4.ts`, `gsc.ts`, `google-ads.ts`, `klaviyo.ts` (dead); each normalises raw API data into the `RawSnapshot` payload schema
- **`lib/guardrails.ts`** — safety layer on the execution path; `hard_block` prevents dangerous changes (large bid swings, pausing high-conversion campaigns without data); thresholds are DB-configurable with 5-min cache
- **`lib/auth.ts`** — three auth paths: `requireAppAuth` (App Bridge JWT), `requireCronAuth` (Bearer `CRON_SECRET`), `apiKeyMatches` (`X-Autopilot-Api-Key`)
- **`lib/job-lock.ts`** — DB-row-based advisory lock; prevents concurrent duplicate cron runs for the same job name
- **`lib/alerts.ts`** — fires webhook alerts (`ALERT_WEBHOOK_URL`) on job failure, stale jobs, and data freshness gaps
- **`lib/content-pilot/`** — separate pipeline for blog content: `generate-proposals.ts` scores existing articles → `ContentProposal` rows → operator approves → draft generation via AI → publish to Shopify blog
- **`lib/market-intel/`** — competitor ad capture, shopping price history, keyword research; stored in `CompetitorAd`, `ShoppingResult`, `KeywordResearchResult` tables

## External Dependencies

External services accessed via HTTP/REST. Connectors live in `lib/connectors/`.

- PostgreSQL (via **prisma**) — only persistent store; all reads and writes go through `import { prisma } from "@/lib/db"`; never instantiate `PrismaClient` directly
- Meta Ads REST API — primary ad channel; reads (metrics) and writes (pause/budget changes); env: `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID`
- Google Ads REST API (via **google-ads-api** package) — keyword research only; no campaign management writes; env: `GOOGLE_ADS_*`
- Google Analytics 4 + Search Console REST APIs (via **google-auth-library**) — Agriko's own analytics; service account JSON auth; env: `GA4_SERVICE_ACCOUNT_JSON` / `GSC_SERVICE_ACCOUNT_JSON`
- Shopify Admin REST/GraphQL API (via **@shopify/shopify-api**) — blog articles, products, images; env: `SHOPIFY_ADMIN_ACCESS_TOKEN` server-side only
- DeepSeek OpenAI-compatible REST API (via **openai** SDK) — primary AI for skill runs; env: `DEEPSEEK_API_KEY`; model `deepseek-v4-flash`
- OpenRouter OpenAI-compatible REST API (via **openai** SDK) — AI fallback and legacy direct-analysis routes; env: `OPENROUTER_API_KEY`
- Serper and DataForSEO REST APIs — Google Shopping intelligence for market intelligence; env: `SERPER_API_KEY`

## What Does NOT Exist Here

- No Google Ads campaign writes — Google Ads is read-only keyword data only; do not add campaign management
- No Klaviyo / Email Pilot — `lib/connectors/klaviyo.ts` exists but is dead code; treat as out of scope
- No built-in job scheduler — external cron on the VPS calls the `/api/cron/*` routes; the app itself does not schedule tasks
- No file storage abstraction — images handled directly via Shopify Admin API; no S3 or CDN layer
