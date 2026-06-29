---
name: skills
description: Skill system — loader, runner, file layout, and how skills create recommendations
metadata:
  type: project
---

# Skills

## Architecture

Skills are pluggable analysis modules that run during `run-skills` (01:00 UTC) and produce `Recommendation` or `ContentProposal` records.

- `lib/skills/loader.ts` — discovers skill files from `skills/` directory
- `lib/skills/runner.ts` — executes each skill with data context
- Each skill exports a `run(context)` function

## Skill file conventions

- Located in `skills/` directory (project root)
- Export default: `async function run(ctx: SkillContext): Promise<SkillResult>`
- `SkillContext` provides DB access, connector data, and config
- Return `{ recommendations: [...], proposals: [...] }`

## Analyzers (`lib/analyzers/`)

- `blog-links.ts` — finds internal linking opportunities between articles
- `blog-seo.ts` — SEO analysis for existing articles
- `blog-topics.ts` — topic gap analysis for new articles
- `html-parser.ts` — shared HTML parsing util

## Test a skill locally

```bash
node scripts/test-skill.mjs skills/<skill-name>.ts
```
