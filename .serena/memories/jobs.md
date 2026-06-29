---
name: jobs
description: Cron schedule, job runner architecture, and JobRun/JobLock models
metadata:
  type: project
---

# Jobs

## Cron schedule (UTC, single source: `/etc/cron.d/autopilot`)

| Time  | Job                        |
|-------|----------------------------|
| 01:00 | run-skills                 |
| 03:00 | fetch-blog-content         |
| 04:00 | fetch-seo-data             |
| 05:00 | fetch-ads-data             |
| 05:30 | fetch-market-intel         |
| 05:45 | fetch-keyword-research     |
| 06:00 | execute-approved ← LIVE    |
| */4   | ping (keep-alive)          |

All cron jobs call `POST /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`.

## Job runner pattern

Each job:
1. Acquires `JobLock` (prevents concurrent runs)
2. Creates `JobRun` with status `running`
3. Runs logic in `jobs/<job>.ts`
4. Updates `JobRun` to `success | partial | failed`
5. Releases lock

`checkAndAlertJobHealth()` in `lib/alerts.ts` fires at end of daily cron — alerts if any job hasn't succeeded in 26h or last 3 runs are all non-success.

## Key env vars

- `EXECUTE_APPROVED_LIVE_ENABLED=true` — gates live execution (false = dry-run)
- `CRON_SECRET` — required bearer token; fails closed if absent
- `ALERT_WEBHOOK_URL` — optional webhook for job failure JSON
