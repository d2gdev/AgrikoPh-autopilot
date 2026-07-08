---
name: skills-recommendations
description: The AI skill system and recommendation lifecycle — skill definitions, runner, guardrails, status flow, and live execution. Load when working on skills, guardrails, or recommendation approval/execution.
triggers:
  - "skill"
  - "recommendation"
  - "guardrail"
  - "execute-approved"
  - "CONVERSION_SENSITIVE"
  - "pause_ad"
  - "pause_campaign"
  - "adjust_budget"
  - "confidenceScore"
  - "skills-source"
  - "orchestrator"
edges:
  - target: context/architecture.md
    condition: when understanding how the skill system fits the overall system
  - target: context/conventions.md
    condition: when writing skill or recommendation handling code
  - target: context/data-pipeline.md
    condition: when the skill system depends on pipeline snapshot data
  - target: context/decisions.md
    condition: when understanding why guardrails, execution gate, or AI provider choices were made
  - target: patterns/debug-pipeline.md
    condition: when skills are not generating recommendations or execute-approved is blocked
last_updated: 2026-07-09T04:30:53Z
---

# Skills & Recommendations

## Skill System

Skills are markdown files in `skills-source/` with frontmatter metadata + a freeform prompt body. They are loaded at runtime by `lib/skills/loader.ts` (uses `gray-matter`). Never hard-code skill prompts in TypeScript.

Organic skills that depend on persisted SEO or market-intelligence connector data should declare source contracts in frontmatter with `requiredSources`, `optionalSources`, `primarySource`, and `freshnessHours`, while keeping legacy `extraSources` during migration. Do not add these contracts to paid-account skills unless the prompt is genuinely organic-source dependent and intended to dispatch as `platform: seo`.

**Skill execution flow:**
```
lib/skills/loader.ts → reads skills-source/*.md
lib/skills/orchestrator.ts → selects applicable skills for a snapshot
lib/skills/runner.ts → sends (system: AGRIKO_CONTEXT + skill.fullPrompt, user: snapshot payload) to DeepSeek
  → response must contain ```recommendations JSON block
  → parseRecommendations() extracts + validates with RecommendationSchema (Zod)
  → valid recs pass to lib/guardrails.ts for guard status
  → saved to DB as Recommendation rows
```

## AI Client (`lib/ai/client.ts`)

- `getAiClient({ deepseekModel, openRouterModel })` — returns `{ client, model }` where `client` is an OpenAI SDK instance pointed at DeepSeek or OpenRouter
- DeepSeek is primary; OpenRouter is fallback
- Default model: `deepseek-v4-flash`
- Never call DeepSeek or OpenRouter directly — always go through `getAiClient()`

## Recommendation Schema

LLM output is validated with Zod `RecommendationSchema` in `lib/skills/runner.ts`. Only records that pass validation are persisted. Invalid records are dropped silently with a `console.warn`.

**Required fields:** `actionType`, `targetEntityType`, `targetEntityId`, `targetEntityName`, `rationale`, `confidenceScore`

**`actionType` values:** `pause_campaign` | `pause_ad` | `adjust_budget` | `change_bid` | `add_negative_keyword`

**`targetEntityType` values:** `campaign` | `ad_set` | `ad` | `keyword`

## Guardrails (`lib/guardrails.ts`)

Every recommendation passes through the guardrail before being saved. The guardrail assigns a `guardStatus`:
- `clear` — safe to execute
- `soft_flag` — unusual but allowed with operator acknowledgement
- `hard_block` — execution is blocked; must be `override_approved` by operator with justification

**`CONVERSION_SENSITIVE_ACTIONS`:** `pause_campaign`, `adjust_budget`, `change_bid` — these require conversion data before executing. **`pause_ad` is deliberately NOT in this set** and must always be executable.

Guardrail thresholds (bid change %, budget change %, min conversions, daily budget threshold) are stored in the DB and cached for 5 minutes — they can be tuned without a code deploy.

## Recommendation Status Lifecycle

```
pending → approved (operator) → executing → executed
       → rejected (operator)
       → override_approved (operator, overrides hard_block) → executing → executed
                                                                         → failed
```

- `reviewedBy` / `reviewedAt` / `reviewNote` — set when operator takes action
- `overrideJustification` + `overrideApprovedBy` — required for `override_approved` status
- `executedAt` + `executionResult` (JSON) — set by the `execute-approved` job

## Execute-Approved Job (`jobs/execute-approved.ts`)

- Cron route: `/api/cron/execute-approved`
- **Only runs live changes when `EXECUTE_APPROVED_LIVE_ENABLED=true`** — otherwise dry-run
- Processes `approved` and `override_approved` recommendations
- Re-runs guardrails immediately before execution (snapshot may have changed since approval)
- Sets status to `executing` (claim), then `executed` (success) or `failed` (error)
- `pause_ad` skips conversion-data guard — always executable
- Meta Ads is the only live write target; Google Ads writes do not exist

## Content Pilot (Separate Sub-System)

Content proposals live in `lib/content-pilot/` and use the `ContentProposal` model — not `Recommendation`. They are generated by `generate-proposals.ts` after blog/SEO fetches and follow a separate lifecycle: `pending` → `approved` → draft generated via AI → `published` to Shopify blog.

Load `context/architecture.md` for the full content pilot flow; this file covers ad recommendations only.
