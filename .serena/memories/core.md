---
name: core
description: Top-level entry point — source map, infra, and links to all domain memories
metadata:
  type: project
---

# Core — Agriko Autopilot

Next.js 14 embedded Shopify app. Automates ad pausing, blog content, SEO, social, and email recommendations for a Shopify merchant.

## Infra

- Server: Linode Ubuntu 22.04 · IP `172.105.161.83` · SSH `~/.ssh/autopilot_deploy`
- Process manager: PM2 (`pm2 logs autopilot --lines 50`)
- DB: PostgreSQL `localhost:5432/autopilot` (Prisma ORM)
- Deploy: `node scripts/linode-deploy.mjs`
- Branch: `versiion-one` → `main`

## Source map

```
app/(embedded)/           — all UI pages (Shopify embedded, App Bridge)
  (ad-pilot)/             — Meta ad recommendations
  (content-pilot)/        — blog content proposals + drafts
  (market-intelligence)/  — competitor/price intel dashboard
  (seo-pillar)/           — SEO advisory
  (email-pilot)/          — email advisory
  (social-pilot)/         — social advisory
  (store-pilot)/          — alt-text suggestions
  settings/               — API credentials UI
app/api/                  — all API routes
  cron/                   — cron job handlers (execute-approved, fetch-*)
  recommendations/        — approve/reject/override
  content-pilot/          — proposals, drafts, publish
  settings/credentials/   — credential CRUD
jobs/                     — pure job logic (no HTTP, called by cron routes)
lib/                      — shared business logic
  config/resolver.ts      — credential resolution (DB-first, env fallback)
  crypto.ts               — AES-256-GCM encrypt/decrypt
  guardrails.ts           — pre-execution safety checks
  executor.ts             — runs approved recommendations against Meta API
  alerts.ts               — job failure + stale-run webhooks
  skills/                 — pluggable skill system (loader + runner)
  connectors/             — external API clients
  ai/                     — LLM call wrappers
scripts/                  — one-shot admin/deploy scripts (mjs)
prisma/schema.prisma      — DB schema
```

See `mem:jobs`, `mem:connectors`, `mem:auth`, `mem:credentials`, `mem:deployment`.
