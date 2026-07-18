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
last_updated: 2026-07-18T16:46:38+08:00
---

# Architecture

## System Overview

**Data ingestion path (cron-driven):**
External cron scheduler → `POST /api/cron/*` (Bearer `CRON_SECRET`) → `acquireJobLock` → job handler in `jobs/` → connector in `lib/connectors/` fetches data from Meta/GSC/GA4/Google Ads/Shopify → upserted as `RawSnapshot` rows in PostgreSQL → `run-skills` job loads `skills-source/*.md` prompts + sends snapshot payload to DeepSeek → parsed `Recommendation` rows written to DB.

**Operator review + execution path:**
Shopify admin iframe → Next.js App Router page (`app/(embedded)/`) → App Bridge session token → embedded API route (`app/api/`) → Prisma query → operator approves recommendation → `execute-approved` cron (only when `EXECUTE_APPROVED_LIVE_ENABLED=true`) → `lib/guardrails.ts` re-checks → live write to Meta Ads API or Shopify Admin API.

**Browser auth:** Embedded browser requests use Shopify App Bridge JWT bearer tokens; browser code must never receive or send `AUTOPILOT_API_KEY`. Embedded app routes call `requireAppAuth(req)` to validate the JWT. When the embedded app and Admin API token-refresh app differ, session verification uses `SHOPIFY_SESSION_API_KEY` / `SHOPIFY_SESSION_API_SECRET` while the Admin connector retains `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. Trusted direct/scripted calls may use the server-only `X-Autopilot-Api-Key` header.

## Key Components

- **`lib/topical-map/`** — server-only strategy-package boundaries: read/hash-check six supplied artifacts, parse the strict typed compilation contract, validate coverage/reference integrity against source bytes, atomically compile typed rules with locator provenance and governed-URL normalization, then purely validate the complete raw/compiled package with an injected `asOf`. A pure evaluator consumes only caller-supplied compiled active strategy identity, validator-derived freshness, and normalized proposal context to return deterministic compliance evidence; it never selects active state, uses time, persists, or authorizes technical execution. `compliance-store.ts` is the separate persistence boundary for Task 8: within the proposal transaction it loads only the complete active `agrikoph.com` version, persisted compiled rules, package identity, and stored freshness report; it then writes a new proposal and immutable compliance evidence together, or stores safe non-proposal evidence for a governed rejection. The secured embedded package routes provide source-free inspection and `SETTINGS_ADMIN`-gated import/activation/rollback delegation; they use only a server-configured package root and safe typed errors. Validation/evaluation report safe conflicts and inspectable mandatory evidence gates (180-day general, 90-day high-stakes) without source bytes, mutation, filesystem, clock, database, activation, API, or live-execution authority. Validation and import are operator-triggered: no topical-map validation cron or job exists. Import records a complete immutable package and report but never activates a version or writes to Shopify or Meta; a separately authorized, audited pointer transition is the only strategy rollback mechanism.
- **SEO Pilot strategy-bound command center** — `GET /api/topical-map/command-center` authenticates before its bounded active-pointer read and projects identity, all eleven rule-domain counts, ownership/pages (including the compiled title separately from the target keyword), governed work, rule resolution/condition/evidence/review policy, bounded phase/schedule authority, and source references without raw strategy artifacts. Revision-3 P0/P1/P2/P3 priorities normalize to operator high/medium/low bands without changing source badges or persisted values. Article evidence uses exact `(blogHandle, handle)` identity and normalized blog paths. SEO analysis snapshots are versioned envelopes bound to the exact strategy version/package hash and carry deterministic candidate IDs plus bounded current-article context; gated suppressions retain optional bounded current-title and observation evidence for operator review without becoming selectable. Selected promotion accepts only the exact analysis timestamp/identity plus at most 100 IDs, reloads current server evidence, independently rejects manual/activation/unsatisfied-condition rules, conditional link wording, and non-additive link instructions, derives title and operational priority from the active map while retaining original priority text, and commits each candidate independently through governed persistence. Gated content remains visible but non-selectable. New-content drafting enforces the persisted map title exactly, and content drafting consumes bounded persisted secondary variants. The retired body-authored map-promotion route returns a bounded `410`; map proposals use persisted candidate IDs only. Internal-link presentation assigns an operational label only from an actual candidate, explicit additive non-blog routing, persisted suppression evidence, or an explicit unsatisfied gate; retain/replace/remove work and absence of per-rule evidence stay neutral. Unmapped GSC demand stays observational; redirect state comes from Store Pilot observation, while canonical/indexation remain advisory and expose their bounded map instructions.
- **Topical-map Store Task execution** — synchronization creates/links a pending Shopify Recommendation only when a resolved non-blog content decision explicitly and unambiguously requests SEO metadata or body-content work; internal-link append tasks additionally require explicit add/ensure intent. Manual gates, activation blockers, unsatisfied conditions, conditional link wording, retain/replace/remove link instructions, keep/preserve/indexation/publication/ambiguous decisions fail closed. It freezes approved bytes from later sync and gives advisory work stable semantic identity with history-preserving supersession; retained pending/failed canonical/index advisories refresh priority, canonical URL, decision, evidence, and publishing state on that identity. Shopify resource observations separate local capture time from resource update time and process bounded AI draft requests in deterministic 25-item chunks. Internal-link tasks retain exact URLs, map-recorded state, purpose/action/verification, original priority, rule status, and observation provenance. List DTOs return a 25-rule preview plus exact total; authenticated detail retains complete active groups up to 100. Redirect support is create-only for a verified absent resolved exact source, with a strict absent→target list/detail DTO; matching redirects are satisfied, missing gated redirects stay advisory, and conflicts retain bounded observed target/ID/time/hash evidence without update authority. Store Pilot approval and execution remain separate operator actions. Live dispatch still requires approved status and `EXECUTE_APPROVED_LIVE_ENABLED=true`, then revalidates proposed hash, strategy identity, current rule policy and mutation intent, current Shopify state, and the owned target lock. Stale identity/state conflicts become audited superseded work, while actual Shopify uncertainty remains bounded reconciliation work. A verified receipt completes Store Task and Recommendation atomically.
- **Rolling topical-map SEO task scheduling** — `lib/seo-tasks/topical-map-scheduler.ts` projects only resolved typed schedule obligations whose complete schedule authority boundary remains proposal-only and execution-prohibited. It retains phase-review tasks and also materializes one exact content task per current strategy-bound content candidate or explicit future schedule action that names an exact governed blog URL. Current candidates are Ready; future content uses the source-authored Manila phase/review window. Conditional, research-only, gated, prohibited, or evidence-unavailable work is excluded. Each content task retains the deterministic Content Pilot candidate ID, exact URL/title/action, priority, optional cluster/role, strategy/package identity, governing rules, and applicable phase rules. Task and Content Proposal history block recreation at synchronization, listing, brief, queue, and mutation boundaries. Content Pilot reads these persisted task identities instead of maintaining a separate actionable backlog. Exact-map briefs are deterministic projections of the mapped assignment, same-cluster ownership boundaries, and exact mapped links; they do not use AI to invent implementation scope. Activation, rollback, fresh SEO analysis, selected promotion, and the locked daily route reconcile the idempotent 90-day window. The scheduler creates local review records only and grants no Shopify, Meta, recommendation-execution, or elapsed-time mutation authority.
- **`jobs/`** — standalone job handler functions; each exports a `[name]Handler()` called by cron routes; writes a `JobRun` row and returns `JobResult<T>`
- **`lib/skills/`** — AI skill system: `loader.ts` reads `skills-source/*.md`, `runner.ts` calls DeepSeek, `orchestrator.ts` coordinates multi-skill runs and deduplicates recommendations
- **`lib/connectors/`** — per-platform data fetchers: `meta.ts`, `ga4.ts`, `gsc.ts`, `google-ads.ts`, `klaviyo.ts` (dead); each normalises raw API data into the `RawSnapshot` payload schema
- **`lib/guardrails.ts`** — safety layer on the execution path; `hard_block` prevents dangerous changes (large bid swings, pausing high-conversion campaigns without data); thresholds are DB-configurable with 5-min cache
- **`lib/auth.ts`** — three auth paths: `requireAppAuth` (App Bridge JWT), `requireCronAuth` (Bearer `CRON_SECRET`), `apiKeyMatches` (`X-Autopilot-Api-Key`)
- **`lib/job-lock.ts`** — DB-row-based advisory lock; prevents concurrent duplicate cron runs for the same job name
- **`lib/alerts.ts`** — fires webhook alerts (`ALERT_WEBHOOK_URL`) on job failure, stale jobs, and data freshness gaps
- **`lib/content-pilot/`** — separate pipeline for blog content: `generate-proposals.ts` scores existing articles → `ContentProposal` rows → operator approves → draft generation via AI → publish to Shopify blog. Governed drafts with an exact blog URL resolve the Shopify source by `(blogHandle, handle)` before AI generation and fail closed if that exact source is unavailable; handle-only fallback is limited to legacy proposals without an exact URL.
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

## Local Development Controller Boundary

`scripts/codex-agent-loop.mjs` is a local, file-backed development orchestrator, not part of the Next.js application or production job pipeline. In plan mode it runs one workspace-writing executor and one read-only planner sequentially, persists private evidence under `.codex-agent-loop/runs/`, and may roll over only through a configured finite number of iteration windows. Its `requiredCleanPasses` profile option requires a structured audit-pass ledger and rejects completion before the configured number of consecutive clean passes; `scripts/codex-surface-loop.mjs` uses that boundary with a fixed requirement of five.

An approved plan authorizes bounded local implementation, verification, documentation, and commits only. Plan text never grants production access, deployment, live Shopify or Meta writes, production database changes, credential or permission changes, destructive actions, scope expansion, strategy activation, or material operator judgment. Those boundaries still produce `awaiting_user`; neither resume nor automatic window rollover weakens the configured Codex sandboxes.

Public status deliberately excludes objectives, prompts, plan source, model output, and operator answers. Plan-aware output is limited to the normalized plan path, task identifiers, iteration/window counters, evidence directory, approval metadata when paused, completion reason, and a validated commit identifier when final execution evidence supplies one.
