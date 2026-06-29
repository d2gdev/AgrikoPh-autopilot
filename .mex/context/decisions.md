---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
  - target: context/skills-recommendations.md
    condition: when the decision relates to AI, guardrails, or recommendation execution
last_updated: 2026-06-25
---

# Decisions

<!-- When a decision changes: DO NOT delete the old entry.
     Mark it as superseded, add the new entry above it. -->

## Decision Log

### DeepSeek as primary AI, OpenRouter as fallback
**Date:** 2025 (active at project maturity)
**Status:** Active
**Decision:** DeepSeek (`deepseek-v4-flash`) is the primary model for all skill runs; OpenRouter is the fallback and is still used by some legacy direct-analysis routes.
**Reasoning:** Cost efficiency — DeepSeek provides competitive output quality at significantly lower token cost than GPT-4-class models for high-volume daily skill runs.
**Alternatives considered:** OpenAI GPT-4 (rejected — too expensive at daily skill-run volume); Anthropic Claude (considered but not chosen as primary for same cost reason).
**Consequences:** `lib/ai/client.ts` handles provider selection. Never call either API directly — always go through the client helper. Both providers use the OpenAI SDK (compatible APIs).

### Operator-review gate before any live execution
**Date:** 2025 (project design)
**Status:** Active
**Decision:** All AI-generated recommendations require explicit operator approval before execution. Live execution is an opt-in controlled by `EXECUTE_APPROVED_LIVE_ENABLED=true` in production.
**Reasoning:** Prevents AI errors from making unreviewed changes to live Meta ad campaigns and Shopify store. The financial and reputational cost of a bad automated change outweighs the convenience of full automation.
**Alternatives considered:** Auto-execution with only guardrail filtering (rejected — guardrails catch hard cases but operator review catches context-specific errors); Email approval flow (rejected — too slow, adds infrastructure).
**Consequences:** `execute-approved` cron is always in dry-run mode unless the env flag is true. The `Recommendation.status` lifecycle is: `pending` → (operator) `approved`/`rejected` → (cron) `executing` → `executed`/`failed`.

### PostgreSQL only — no secondary data stores
**Date:** 2025 (project start)
**Status:** Active
**Decision:** All persistent state lives in PostgreSQL via Prisma. No Redis, no secondary SQLite (except local competitor scraper DB which is outside the main app).
**Reasoning:** Operational simplicity — one database to backup, monitor, and reason about on a single VPS.
**Alternatives considered:** Redis for job locking (rejected — DB row-based locking in `lib/job-lock.ts` is sufficient at this scale); Redis for session caching (rejected — App Bridge tokens are stateless JWTs).
**Consequences:** Job deduplication is handled by `lib/job-lock.ts` using `JobRun` rows. If lock rows get stuck (process crash), they must be manually cleared or the stale-job cleanup cron handles it.

### Self-hosted on Linode VPS with PM2 + nginx
**Date:** 2025 (project start)
**Status:** Active
**Decision:** The app runs as a persistent Node.js process managed by PM2 on a Linode VPS behind nginx + certbot TLS. Domain: `https://autopilot.agrikoph.com`.
**Reasoning:** Cost and long-running job support. Cron jobs can run for 300 seconds; serverless function timeout limits make that impractical without a dedicated queue service.
**Alternatives considered:** Vercel (rejected — 300s cron jobs exceed free-tier limits and add cost); Railway (evaluated but self-hosted VPS is cheaper for always-on workload).
**Consequences:** `server.js` must handle SIGTERM gracefully so PM2 restarts don't strand `JobRun` rows in `running` state. Deployment uses `scripts/linode-deploy.mjs` (rsync + SSH).

### External cron scheduler, not built-in scheduling
**Date:** 2025 (project start)
**Status:** Active
**Decision:** An external scheduler (system cron on the VPS) calls `/api/cron/*` HTTP routes with `Authorization: Bearer $CRON_SECRET`. The app does not self-schedule.
**Reasoning:** Separation of concerns — the cron schedule can be inspected and modified without a code deploy. Routes are also manually callable for debugging.
**Alternatives considered:** Built-in Next.js cron support (not available in self-hosted); node-cron inside the server process (rejected — coupling scheduling to process lifecycle, harder to observe).
**Consequences:** All cron routes must validate `CRON_SECRET`. `requireCronAuth` fails closed in production — if `CRON_SECRET` is unset, all cron requests are rejected with 500.

### `pause_ad` excluded from `CONVERSION_SENSITIVE_ACTIONS`
**Date:** 2025
**Status:** Active
**Decision:** `pause_ad` is NOT in the `CONVERSION_SENSITIVE_ACTIONS` set in `lib/guardrails.ts` and must always be executable regardless of conversion data.
**Reasoning:** Zero-conversion ads are precisely the candidates for pausing. Unlike pausing a whole campaign or changing a budget, pausing one ad carries low financial risk even without conversion history. The campaign and other ads in the same snapshot still show conversion context.
**Alternatives considered:** Requiring conversion data for `pause_ad` (rejected — would block the most obvious optimization actions on new or underperforming creatives).
**Consequences:** Do not add `pause_ad` to `CONVERSION_SENSITIVE_ACTIONS`. The guardrail check skips conversion data requirements for this action type.

### Meta is the only active ad channel for writes
**Date:** 2025
**Status:** Active
**Decision:** Meta Ads is the only platform where the app can execute changes (pause, budget, bid). Google Ads is read-only (keyword research). No Google Ads campaign management.
**Reasoning:** Agriko's active paid campaigns run on Meta. Google Ads integration exists solely for keyword planning data.
**Consequences:** Skills that reference Google Ads campaign actions should generate recommendations only — the execution path for Google Ads writes does not exist. Do not build it.
