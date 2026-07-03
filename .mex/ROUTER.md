---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: context/data-pipeline.md
    condition: when working on data ingestion, connectors, job handlers, or snapshots
  - target: context/skills-recommendations.md
    condition: when working on AI skills, guardrails, or the recommendation lifecycle
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
last_updated: 2026-07-03T10:10:00Z
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State

**Working:**
- Full daily cron pipeline: fetch-ads-data, fetch-seo-data, fetch-blog-content → run-skills → recommendations
- Operator review UI in Shopify admin (approve/reject/override recommendations)
- execute-approved cron (live execution active in prod via `EXECUTE_APPROVED_LIVE_ENABLED=true`)
- Market intelligence: competitor ads, shopping price history, keyword research
- Content Pilot: proposal generation → draft generation → publish to Shopify blog
- ROAS health badges and inline recommendation approval on campaigns page
- Review-action safety UX (2026-07-03, audit Tier 1): Approve on Campaigns + Recommendations opens a shared confirmation modal (`components/ui/approve-confirmation-modal.tsx`) showing the concrete current→proposed change before committing; reject/override modals and Settings credential delete now check `res.ok` and surface failures; approve/reject show a success Toast with Undo backed by a new `POST /api/recommendations/[id]/revert` route (atomic approved/rejected→pending, audit-logged, 409s once the executor claims the rec; override_approved excluded). Also fixed: campaigns reject sent `{reason}` but the API reads `note`, so rejection notes were silently dropped.
- Dashboard v2: ad spend delta, content pilot stats, rec breakdown by action type, collapsible job rows with trend dots + staleness tinting, loading skeletons
- GSC + GA4 data ingestion and SEO pillar dashboard
- Guardrails with DB-configurable thresholds (5-min cache)
- Job locking, health alerts, data freshness monitoring
- Odysseus self-hosted AI workspace at https://odysseus.agrikoph.com — Docker Compose on prod, nginx reverse proxy with Let's Encrypt SSL, embedded as iframe dashboard at `/odysseus` in auto-pilot nav
- Ad Approval workflow (Ad Pilot → Ad Approvals): full state machine, 3 AI review agents (Pre/Brand/Technical, text+HTTP; vision checks stubbed as SKIPPED in v1), Conversion scoring rubric, Penultimate/Final human approval, conflict-of-interest detection, revision history, SLA escalation cron, in-app notifications, Settings reviewer assignment. Code + tests landed and build-clean; migration applied on prod (deploy script runs `migrate deploy` automatically). Async work runs via two new crons: `/api/cron/process-ad-reviews` and `/api/cron/ad-approval-sla` (every 5 min; scheduler is external, see docs/CRON.md).
- DataForSEO Labs organic data (Task 8): `lib/connectors/dataforseo-labs.ts` (`fetchRankedKeywords`, `fetchDomainIntersection`) + a new `jobs/fetch-market-intel.ts` step producing `RawSnapshot` sources `dataforseo_ranked` and `dataforseo_keyword_gap`, plus `keyword_gap` `MarketInsight`s. Independent organic-visibility source while GSC is 403. Gated behind `DATAFORSEO_LABS_ENABLED` (unset/not "true" = fully skipped, no request, no snapshot) — **ENABLED in prod since 2026-07-03** with `DATAFORSEO_LABS_LOCATION=Philippines` (Labs-only location override; live probe 2026-07-03: the PH Labs database has 0 ranked keywords for agrikoph.com vs 31 in US, so `rankedKeywordsFetched` may stay 0 until PH coverage improves — this is data coverage, not a bug; ~$0.012/call, ~4 calls/day). DataForSEO credentials were copied to `/opt/autopilot/.env` 2026-07-03 (previously local-only). The Task 2 `gsc` extra-context fallback chain now extends to `gsc → gsc_query_page → dataforseo_ranked` (`lib/skills/extra-context.ts`). See `docs/MARKET_INTELLIGENCE.md` for field-level detail.
- Recommendation outcome feedback loop: `jobs/check-outcomes.ts` compares before/after connector snapshots for `executed` recommendations 7+ days old, writes the verdict to `Recommendation.outcome`/`outcomeCheckedAt`, and indexes a `recommendation_outcome` KB chunk so future skill runs are grounded in what actually worked. **LIVE in prod since 2026-07-03**: migration `20260702100000_add_recommendation_outcome` applied via deploy (`prisma migrate status`: up to date), cron entry `/api/cron/check-outcomes` installed in `/etc/cron.d/autopilot` at 07:00 daily, and the first manual run succeeded (22 recommendations checked, 9 outcomes indexed, 0 failures). `jobs/index-knowledge.ts`'s orphan-deletion pass is scoped to `INDEXED_SOURCE_TYPES` (`lib/ai/knowledge-sources.ts`) so it never deletes `recommendation_outcome` chunks, which it doesn't own.

**Not yet built / in progress:**
- Social Pilot — page exists but pipeline not fully wired
- Ad Pilot automated creative generation — recommendations exist but creative upload flow incomplete
- Store Pilot — images page and store-pilot page exist; scope TBD

**Known issues:**
- ~~GSC 403 / access blocked~~ RESOLVED (verified 2026-07-03): service account `analytics-ga-4@gen-lang-client-0853027342` is siteOwner on `sc-domain:agrikoph.com`, fetch-seo-data/fetch-gsc-data succeed daily, 13.8k GscQuery rows, live query probe returns real PH rankings. Remaining caveat is genuine low click volume (small site, ~1 click/query) — peso-sizing insights are limited by traffic, not access
- Competitor price stream has noisy data; de-noising is needed before price-based recommendations are reliable
- Legacy direct-analysis routes still use OpenRouter instead of DeepSeek primary — gradual migration ongoing
- `better-sqlite3` competitor scraper DB is local-only; prod market intel uses Serper/DataForSEO instead
- Competitor "Falo" (falo.ph) has no valid numeric Facebook page ID configured — its `CompetitorSocialPage` row was deactivated by `scripts/seed-competitors.mjs` (non-numeric pageId) and never replaced, so `jobs/fetch-market-intel.ts` silently captures zero ads for it every run. Apify ad-library search and anonymous Facebook scraping couldn't resolve the numeric ID automatically — needs a human to pull it from Facebook's Page Transparency panel and add it via Manage Tracking.
- Adding a competitor/page with a non-numeric pageId directly via SQL/seed script (bypassing `app/api/market-intelligence/config/route.ts`'s Zod validation) produces a permanently-broken, silent scrape target with no operator-visible error — watch for this pattern when seeding competitors outside the API.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Data ingestion, connectors, job handlers | `context/data-pipeline.md` |
| AI skills, guardrails, recommendations | `context/skills-recommendations.md` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it. Narrate what you load: "Loading architecture context..."
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. If the why matters, run `mex log --type decision "<what changed and why>"` or `mex log "<note>"`.
