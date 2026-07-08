---
name: debug-pipeline
description: Diagnosing failures in the data pipeline — connector errors, failed skill runs, stale snapshots, stuck JobRun rows, and recommendation dry-runs.
triggers:
  - "debug"
  - "pipeline failing"
  - "job failed"
  - "no recommendations"
  - "snapshot missing"
  - "skill not running"
  - "execute-approved not working"
  - "stuck job"
  - "stale job"
  - "ads not showing"
  - "competitor ads missing"
edges:
  - target: context/data-pipeline.md
    condition: for full pipeline structure and component responsibilities
  - target: context/skills-recommendations.md
    condition: for skill runner and guardrail debug paths
  - target: patterns/add-cron-job.md
    condition: if the fix involves changing a job handler
last_updated: 2026-07-09
---

# Debug Pipeline

## Context

The pipeline has four major failure boundaries:
1. **Connector** — external API call fails (rate limit, expired token, wrong config)
2. **Snapshot** — data fetched but upsert fails (unique key violation, schema mismatch)
3. **Skill runner** — LLM call fails or returns unparseable output
4. **Execution** — approved recommendation execution blocked by guardrail or connector write fails

Check `JobRun` rows first — they are the authoritative record of what ran and what failed.

---

## Task: Diagnose a Failed or Partial Job

### Steps

1. Check recent `JobRun` rows in Prisma Studio (`npm run db:studio`) or via:
   ```sql
   SELECT "jobName", status, "errorLog", "summary", "startedAt", "completedAt"
   FROM "JobRun"
   ORDER BY "startedAt" DESC
   LIMIT 20;
   ```
2. Look at `errorLog` on `failed` rows — this is the raw error message from the handler's `catch` block
3. If `status = "running"` with no `completedAt` and `startedAt` is old → the job crashed without cleanup
   - Run `npm run jobs:stale` to identify stuck rows
   - Manually set status to `failed` via Prisma Studio; `acquireJobLock` will be blocking new runs
4. Trigger the failing cron manually to reproduce:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://autopilot.agrikoph.com/api/cron/fetch-ads-data
   ```
   Or on the prod server: `ssh autopilot-prod` then inspect `/opt/autopilot` logs via PM2: `pm2 logs autopilot`

### Gotchas

- `partial` is not a failure — it means some items succeeded. Skills still run when any fetch returns `partial`.
- A `JobRun` stuck in `running` blocks `acquireJobLock` for that job name — all subsequent cron calls return 409 until it's cleared.

---

## Task: Diagnose No Recommendations Generated

### Steps

1. Check whether `RawSnapshot` rows exist for the relevant source and date range:
   ```sql
   SELECT source, "fetchedAt", "dateRangeStart", "dateRangeEnd"
   FROM "RawSnapshot"
   ORDER BY "fetchedAt" DESC
   LIMIT 10;
   ```
2. If snapshots are missing → the data fetch job failed. Fix the connector (see Task above).
3. If snapshots exist but no recommendations → check `run-skills` job run for errors in `errorLog`
4. Check whether the LLM returned an empty recommendations block (`[]`) — this is valid and not a bug if the data genuinely has no actionable changes
5. Look for Zod validation failures in the PM2 logs: `[runner] skill response failed validation`
6. Check `Recommendation` rows with `guardStatus = "hard_block"` — they exist but are blocked from execution; they are not missing
7. When SEO/content skills do not run, inspect the latest `run-skills` `JobRun.summary.sourceStatus`, `sourceRefreshes`, and `skillsUnavailable` before checking model output. A missing required source is a data availability problem, not an LLM problem.

### Gotchas

- The daily cron skips skills entirely if **all three** data fetches (ads, seo, blog) fail. If one succeeds, skills run.
- Skills are deduped by hash in `lib/skills/orchestrator.ts` — identical recommendations from consecutive runs are not re-inserted. If you expect new recs but none appear, the same recs may already exist in `pending` status.
- `run-skills` skip hashes are per-skill deterministic pre-AI input fingerprints, not just the Meta snapshot. They include the assembled data payload and skill prompt identity, but intentionally exclude dynamic KB grounding/provider output. Deferred skills preserve their prior hashes across the 30-skill round-robin cap; failed/truncated dispatched skills lose stale hashes so they retry. If a skill with `extraSources` seems stale, compare the latest `JobRun.summary.skillHashes[skillId]` before and after the relevant GSC/GA4/Market Intelligence/keyword-research data changes; if the hash changes but no recs appear, debug LLM output/parsing next.
- `confidenceScore` must be 0.0–1.0; the Zod schema rejects values outside this range silently.
- **Empty-content AI model (recurring landmine):** an invalid/deprecated DeepSeek model name returns **HTTP 200 with empty `content`** (no error) — every JSON-parsing feature then silently produces nothing (`parseJsonArray`→`[]`, `parseStolenAd`→"malformed response", zero recommendations). The known-bad string is `deepseek-v4-flash`; `deepseek-chat` returns real content. Resolution order in `getAiClient()` is `DEEPSEEK_MODEL` env/DB → caller `options.deepseekModel` → `DEFAULT_DEEPSEEK_MODEL`. If AI features go quiet, verify the resolved model actually returns content: `curl -s -H "Authorization: Bearer $KEY" -X POST https://api.deepseek.com/chat/completions -d '{"model":"<model>","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'` and check `choices[0].message.content` is non-empty. Keep `DEEPSEEK_MODEL=deepseek-chat` set in `.env` (local + prod).
- **DeepSeek ECONNRESET on long responses (recurring):** DeepSeek intermittently resets the socket mid-response-body from the prod host — surfaces as `Invalid response body while trying to fetch https://api.deepseek.com/... read ECONNRESET` and breaks briefs / run-skills / content-pilot drafts. The OpenAI SDK's `maxRetries` does NOT recover it (the reset happens after headers, during body read). Use `chatCompletionWithFailover()` from `lib/ai/client.ts` instead of `ai.client.chat.completions.create()` — it falls over to OpenRouter (same models, different network path) on connection-level errors only (via `isConnectionError()`; 4xx/auth are not failed over). Forward any `AbortSignal` through `{ requestOptions: { signal } }`.
- **NaN-from-env:** parse env-int limits with the exported `envInt()` from `lib/market-intel/profiles.ts` (guards `Number.isFinite`), never bare `Number(process.env.X ?? n)` — a non-numeric value yields `NaN` → `Math.max(1, NaN)=NaN` → Prisma `take: NaN`.
- **Same-day insight dedupe needs a per-row discriminator:** `saveOpenDailyMarketInsight` keys on `type|competitorId|keywordId|adId|day`. For `price_change` (many products share one keyword/competitor/day) pass the `productKey` as the 3rd `discriminator` arg or the insights overwrite each other.

---

## Task: Diagnose execute-approved Not Executing

### Steps

1. Verify `EXECUTE_APPROVED_LIVE_ENABLED=true` in the production `.env` — without it, the job runs in dry-run mode and produces no changes
2. Check `Recommendation` rows with `status = "approved"` — if there are none, nothing will execute (operator must approve first)
3. Check `guardStatus` on approved recommendations — `hard_block` recs require `override_approved` status (not just `approved`) before they execute
4. Check the `execute-approved` `JobRun` errorLog for connector-level errors (e.g. Meta API auth failure)
5. Verify `META_ACCESS_TOKEN` is not expired — check `META_TOKEN_EXPIRES_AT` in env; the connector health page in the UI shows token expiry warnings
6. For `pause_ad`: this action is always allowed — if it's being blocked, check whether `pause_ad` was accidentally added to `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts`

### Gotchas

- `execute-approved` re-runs guardrails at execution time. A recommendation approved when snapshot data was fresh may be re-blocked if the snapshot has since changed.
- `pause_ad` must NOT require conversion data — see `context/skills-recommendations.md` for the guardrail design decision.

---

## Task: Diagnose Connector Auth Failures

### Symptom: connector returns 401/403 or "token expired"

| Connector | Token location | Refresh mechanism |
|-----------|---------------|-------------------|
| Meta Ads | `META_ACCESS_TOKEN` env | Manual — check `META_TOKEN_EXPIRES_AT`; 60-day rolling token |
| Shopify Admin | `SHOPIFY_ADMIN_ACCESS_TOKEN` env | `npm run shopify:refresh-token` |
| GSC / GA4 | Service account JSON | Never expires unless rotated manually |
| Google Ads | `GOOGLE_ADS_REFRESH_TOKEN` env | OAuth refresh token; rotate if revoked |

### Gotcha: quota/rate-limit must DEGRADE (return `disabled`), not throw

A shopping/keyword connector that has a fallback (Serper → DataForSEO) must return `{ disabled: true, products: [] }` on quota/auth/rate-limit statuses (`401/402/403/429`), **not** throw. `serper-shopping.ts` originally threw on any `!res.ok`, but `disabled` was only set when the API key was missing — so a Serper 403 "Not enough credits" threw once per keyword/competitor, the caller's `catch` just logged it, the DataForSEO fallback (gated on `.disabled`) never fired, and `disabledSources` was never marked. Fixed to map those statuses to `disabled`. If a connector with a fallback isn't degrading (job logs many per-keyword errors but never falls back or marks the source disabled), check that its `!res.ok` branch returns `disabled` for 4xx quota codes. (`dataforseo-shopping.ts` still throws on `!res.ok` — lower impact as the last-resort source, but the same shape.)

---

## Task: Diagnose Competitor Ads Not Appearing in the Market Intelligence UI

### Symptom: "Ads" tab shows few/no ads for a competitor, or a tracked competitor never shows anything

Two independent layers can each cause this — check both, don't stop at the first plausible one:

1. **Is the competitor even being scraped?**
   - Query `CompetitorSocialPage` for the competitor: `active` must be `true` AND `pageId` must be purely numeric (`/^\d+$/`). `jobs/fetch-market-intel.ts` only sends numeric `pageId`s to Apify (`apify-meta-ads.ts` filters with `/^\d+$/.test(id)`), and there's no scraper fallback — a non-numeric `pageId` (a URL, vanity slug, or empty string) is silently dropped with zero error/log entry, forever.
   - `config/route.ts`'s POST validates `pageId` is numeric on the UI path, so this class of bug only enters via direct SQL/seed-script inserts that bypass that route — check for that if a competitor has a suspicious `pageId`.
   - `scripts/seed-competitors.mjs` deactivates any social page with a non-numeric `pageId` but does NOT supply a replacement — if a competitor's only page gets deactivated this way, it silently stops capturing anything until a human finds and adds the correct numeric Facebook page ID (via Facebook's own Page Transparency panel; Apify ad-library keyword search and anonymous scraping are unreliable for resolving vanity names → numeric IDs).
   - Also check for accidental duplicate `Competitor` rows (same brand, slightly different name string) — `competitor.upsert` keys on exact `name`, so "Organics.ph" and "Organics PH" become two different rows, and the duplicate may carry the broken `pageId` while the original works fine.

2. **Is the UI filtering it out even though it was captured?**
   - `app/(embedded)/(market-intelligence)/market-intelligence/page.tsx`'s Ads tab defaults to showing only "proven, long-running" ads (`startDate` 60+ days in the past). A competitor whose captured ads are all newer than 60 days will show **zero** cards by default even though the API returned them — check the "Show all captured ads" checkbox (added to cover this) before concluding nothing was captured.
   - The API (`app/api/market-intelligence/route.ts`) also only returns the most recent 80 `CompetitorAd` rows (by `capturedAt`) before the UI filter even runs — a competitor whose ads weren't in the most recent capture batch can be crowded out if capture volume is high.

### Gotchas

- Don't diagnose from the DB total count alone — a competitor can have hundreds of captured ads and still show nothing in the UI if none of them are 60+ days old. Reproduce with the actual API response + front-end filter logic (`competitorAds` → `isSpamStoryAd` → 80-row/50-row API caps → UI date-range/60-day/dedup filters), not just `SELECT count(*)`.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Known Issues" if a systemic issue was found
- [ ] Update `context/data-pipeline.md` if a connector failure mode was discovered
- [ ] If this debug path will recur, update the Gotchas section in this pattern
