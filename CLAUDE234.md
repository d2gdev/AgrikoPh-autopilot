# CLAUDE.md — Agriko Autopilot

## Stack

Next.js App Router · Prisma ORM · TypeScript strict · Node 20

## Memory system

Project knowledge lives in `.serena/memories/`. Read `mem:core` first, then follow domain refs:

- `mem:core` — source map, infra overview, all memory links
- `mem:jobs` — cron schedule, job runner pattern, env vars
- `mem:credentials` — resolver hierarchy, encryption, Shopify token auto-refresh
- `mem:connectors` — Meta, Shopify, Google, SEO connectors
- `mem:auth` — App Bridge session auth vs admin token vs cron secret
- `mem:recommendations` — approval lifecycle, guardrails, executor
- `mem:content-pilot` — blog index → proposal → draft → publish
- `mem:deployment` — deploy command, server layout, PM2, cron
- `mem:skills` — skill loader, runner, analyzer files
- `mem:market-intelligence` — MI models, jobs, dashboard filters
- `mem:advisory-pilots` — SEO/Email/Social/Store (read-only, no automated actions)

## Required workflow

1. Read `mem:core` (or the relevant domain memory) before reading source files.
2. Search before reading. Read targeted ranges, not whole files.
3. Edit.
4. TypeScript check: `rtk tsc --noEmit`
5. Deploy: `node scripts/linode-deploy.mjs`

## Shell commands

Prefix with `rtk` for trimmed output: `rtk grep`, `rtk git log`, `rtk git diff`, `rtk find`, `rtk ls`, `rtk npm`, `rtk tsc`, `rtk read`.

The `rtk-enforcer` hook does this automatically — except inside `$(...)`, after `node`, or in subagents. Prefix explicitly there.

## Key invariants

- Credential resolver checks DB before `.env` — never write secrets to `.env` from running code.
- `pause_ad` is NOT in `CONVERSION_SENSITIVE_ACTIONS` — it must always be allowed to execute.
- `EXECUTE_APPROVED_LIVE_ENABLED=true` on prod server — the execute-approved cron is live.
- All cron routes require `Authorization: Bearer $CRON_SECRET` — fails closed if unset.
- Shopify admin token auto-refreshes on 401 — no manual intervention needed.
- GSC service account is added to Search Console and authorized (fixed 2026-06-23); `fetch-gsc-data` pulls successfully. The old 403 is resolved — do not treat GSC as blocked.

## Codesight (orient before reading source)

Read wiki articles before opening source files — never infer logic from wiki alone.

1. `.codesight/wiki/index.md` — orientation map
2. `.codesight/wiki/overview.md` — architecture overview
3. Domain article → check "Source Files" → read those files

Or query via MCP: `codesight_get_wiki_article`, `codesight_get_routes`, `codesight_get_schema`, `codesight_get_blast_radius`.

## Repomix

Default snapshot: `npx repomix --compress --output repomix-core.xml` (excludes plans, `.codesight/`, build artifacts — see `repomix.config.json`).

Plans snapshot: `npx repomix docs/superpowers/plans --compress --output repomix-plans.xml`
