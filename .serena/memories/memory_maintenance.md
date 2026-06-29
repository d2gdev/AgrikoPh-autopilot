---
name: memory_maintenance
description: How to read and maintain the Serena memory graph
metadata:
  type: reference
---

# Memory Maintenance

## Discovery model

- Read `mem:core` first — it's the graph root
- Follow `mem:` references in each file to drill into a domain
- Only read memories relevant to the current task; don't load all of them

## Memory references

Use backtick `mem:name` syntax to reference another memory. Examples:
- `mem:core` — top-level source map
- `mem:jobs` — cron schedule and job runner
- `mem:credentials` — credential resolver and encryption
- `mem:connectors` — external API clients
- `mem:auth` — session token auth
- `mem:recommendations` — recommendation lifecycle and guardrails
- `mem:content-pilot` — Content Pilot flow
- `mem:deployment` — deploy procedure
- `mem:skills` — skill system
- `mem:market-intelligence` — MI dashboard and models
- `mem:advisory-pilots` — SEO/Email/Social/Store (read-only pilots)

## Style

Dense agent notes — invariants and non-obvious facts only. No rationale, no examples unless they prevent likely mistakes. No task-local notes (those belong in PR descriptions).

## Add/update threshold

Add a memory only for stable, non-obvious conventions that avoid rediscovery. Do NOT add: quick-read facts, generic framework knowledge, volatile line-level details.
