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
last_updated: 2026-06-29T02:30:00Z
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
- Dashboard v2: ad spend delta, content pilot stats, rec breakdown by action type, collapsible job rows with trend dots + staleness tinting, loading skeletons
- GSC + GA4 data ingestion and SEO pillar dashboard
- Guardrails with DB-configurable thresholds (5-min cache)
- Job locking, health alerts, data freshness monitoring
- Odysseus self-hosted AI workspace at https://odysseus.agrikoph.com — Docker Compose on prod, nginx reverse proxy with Let's Encrypt SSL, embedded as iframe dashboard at `/odysseus` in auto-pilot nav

**Not yet built / in progress:**
- Social Pilot — page exists but pipeline not fully wired
- Ad Pilot automated creative generation — recommendations exist but creative upload flow incomplete
- Store Pilot — images page and store-pilot page exist; scope TBD

**Known issues:**
- GSC data density is low until GSC access is fully fixed and Agriko's property is confirmed — peso-sizing insights return ~₱0 until resolved
- Competitor price stream has noisy data; de-noising is needed before price-based recommendations are reliable
- Legacy direct-analysis routes still use OpenRouter instead of DeepSeek primary — gradual migration ongoing
- `better-sqlite3` competitor scraper DB is local-only; prod market intel uses Serper/DataForSEO instead

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
