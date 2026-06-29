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
edges:
  - target: context/data-pipeline.md
    condition: for full pipeline structure and component responsibilities
  - target: context/skills-recommendations.md
    condition: for skill runner and guardrail debug paths
  - target: patterns/add-cron-job.md
    condition: if the fix involves changing a job handler
last_updated: 2026-06-25
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

### Gotchas

- The daily cron skips skills entirely if **all three** data fetches (ads, seo, blog) fail. If one succeeds, skills run.
- Skills are deduped by hash in `lib/skills/orchestrator.ts` — identical recommendations from consecutive runs are not re-inserted. If you expect new recs but none appear, the same recs may already exist in `pending` status.
- `confidenceScore` must be 0.0–1.0; the Zod schema rejects values outside this range silently.

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

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Known Issues" if a systemic issue was found
- [ ] Update `context/data-pipeline.md` if a connector failure mode was discovered
- [ ] If this debug path will recur, update the Gotchas section in this pattern
