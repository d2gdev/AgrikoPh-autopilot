---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-06-25
---

# Agriko Autopilot

## What This Is
A private Shopify embedded app that pulls ad, SEO, blog, and market-intelligence data into PostgreSQL, runs AI skills to generate recommendations, and requires operator approval before writing any changes back to Meta or Shopify.

## Non-Negotiables
- Never execute live ad or Shopify changes unless `EXECUTE_APPROVED_LIVE_ENABLED=true` AND recommendation status is `approved`/`override_approved`
- All database access via `import { prisma } from "@/lib/db"` — never instantiate `PrismaClient` directly
- Every embedded app API route must call `await requireAppAuth(req)` as the first statement; every cron route must call `requireCronAuth(req)` (sync) then `acquireJobLock`
- `AUTOPILOT_API_KEY` is server-side only — never prefix with `NEXT_PUBLIC_`
- `pause_ad` is NOT in `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts` — it must always be executable (do not add it to that set)

## Commands
- Dev: `npm run dev`
- Test: `npm test` / watch: `npm run test:watch`
- Build: `npm run build`
- DB migrate: `npm run db:migrate`
- DB client regen: `npm run db:generate`
- DB browser: `npm run db:studio`
- Lint: `npm run lint`
- Data health: `npm run data:audit`
- Prod server: `ssh autopilot-prod` → app at `/opt/autopilot`

## After Every Task
After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `.mex/ROUTER.md` and relevant `.mex/context/` files
- Orient: create or update a `.mex/patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files and run `mex log` when rationale matters

## Surface-Fix Execution Contract
- For an authorized `$surface-fix --fix` or `--deploy` run, do not return routine progress, plans, or “next step” messages. Return only a start acknowledgement, a blocker requiring new authority, or the final verified result.
- Never report `merged`, `deployed`, or `complete` unless the persisted Surface-Fix state records every required gate as passed.
- `deployed` additionally requires matching server commit, newer active build artifact, newer PM2 process, and healthy public endpoint evidence.
- Record rejected audit findings with evidence; do not reintroduce them as defects.

## Navigation
At the start of every session, read `.mex/ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance — everything is there.
