# Operations

This document covers the active Linode deployment. It is the single source of truth for how to deploy, monitor, recover, and pause the app in production.

## Server

| Property | Value |
|---|---|
| Host | Linode VPS |
| IP | `172.105.161.83` |
| Domain | `autopilot.agrikoph.com` |
| OS | Ubuntu 22.04 |
| App path | `/opt/autopilot` |
| Env file | `/opt/autopilot/.env` |
| Process manager | PM2 (`autopilot`) |
| Web server | nginx (reverse proxy on 443 → localhost:3000) |
| RAM / swap | 2 GB RAM + 2 GB swap (`/swapfile-autopilot`) |
| SSH key | `~/.ssh/id_ed25519_autopilot` (Ed25519) |

```bash
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
```

## Deploy

```bash
node scripts/git-deploy.mjs
```

The default command deploys local `main`. The working tree must be clean. For an emergency non-main deployment, name the branch and explicitly acknowledge the override:

```bash
node scripts/git-deploy.mjs --branch feature/emergency --allow-non-main
```

SSH host-key verification remains enabled. Before the first deployment, connect once with `ssh autopilot-prod` and verify/save the VPS fingerprint in `~/.ssh/known_hosts`; do not bypass host verification.

What it does:
1. Validates a clean working tree and pushes `main` (or an explicitly allowed non-main branch) to `origin`
2. Fetches that branch into `/opt/autopilot` on the VPS
3. Preserves server-owned runtime files (`.env`, `node_modules`, `.next`, `.npm-cache`)
4. Removes stale local env files left on the server
5. Ensures 2 GB swap is mounted
6. `npm install --prefer-offline` using `/opt/autopilot/.npm-cache` and preserving existing native modules
7. Seeds `.next.build/cache` from the previous `.next/cache`
8. Builds into `.next.build` with `NEXT_OUTPUT_DIR=.next.build npm run build:remote`
9. `npm run db:migrate` only after the new build succeeds
10. Atomic swap: `mv .next .next.old && mv .next.build .next`
11. `pm2 restart autopilot --update-env`
12. Restores `.next.old` if PM2 cannot start the new build; otherwise removes it

Set `LINODE_IP` or ensure `scripts/.linode-ip` exists. The deploy script uses `SSH_KEY` when set, otherwise it auto-detects `~/.ssh/autopilot_deploy`, `~/.ssh/id_ed25519_autopilot`, then `~/.ssh/id_ed25519`. It reads `GITHUB_TOKEN` from local env / `.env` for git push/fetch auth.

Legacy fallback: `node scripts/linode-deploy.mjs` still performs the old rsync deployment, but it should not be the default path.

**The server `.env` is never overwritten by deploy.** Update env values directly on the server:

```bash
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
nano /opt/autopilot/.env
pm2 restart autopilot --update-env
```

## Cron

Cron is managed by `/etc/cron.d/autopilot` on the Linode server. There is no other scheduler. Do not add a root crontab.

The cron file reads `CRON_SECRET` from `/opt/autopilot/.env` at runtime — it does not hardcode the secret.

### Active Schedule (UTC)

| Time | Route | Purpose |
|---|---|---|
| 01:00 | `/api/cron/daily` | Daily health pipeline, skills, proposals, cleanup, and alerts |
| 03:00 | `/api/cron/fetch-blog-content` | Index Shopify blog articles |
| 04:00 | `/api/cron/fetch-seo-data` | Pull GSC + GA4 snapshots |
| 04:30 | `/api/cron/snapshot-seo-history` | Store durable SEO trend point |
| 05:00 | `/api/cron/fetch-ads-data` | Pull Meta ad snapshots |
| 05:30 | `/api/cron/fetch-market-intel` | Shopping + Meta Ad Library captures |
| 05:45 | `/api/cron/fetch-keyword-research` | Google Ads keyword metrics |
| Mon 05:50 | `/api/cron/fetch-gsc-data` | Store query+page GSC rows |
| 06:00 | `/api/cron/execute-approved` | Dry-run approved execution queue |
| Every minute | `/api/cron/drain-jobs?limit=1` | Drain durable dashboard refresh queue |

### Pause cron

```bash
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
mv /etc/cron.d/autopilot /etc/cron.d/autopilot.disabled
```

Restore:
```bash
mv /etc/cron.d/autopilot.disabled /etc/cron.d/autopilot
```

### Trigger a job manually

```bash
CRON_SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2)
curl -sf -H "Authorization: Bearer $CRON_SECRET" https://autopilot.agrikoph.com/api/cron/fetch-ads-data
```

### Dry-run execute-approved

Always dry-run before the first live execution pass after a schema or executor change:

```bash
CRON_SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2)
curl -sf -H "Authorization: Bearer $CRON_SECRET" "https://autopilot.agrikoph.com/api/cron/execute-approved?dryRun=true"
```

Dry-run records:
- `JobRun.dryRun = true`
- `AuditLog.action = execution_dry_run_started / execution_dry_run_success / execution_dry_run_failed / execution_dry_run_blocked`
- `AuditLog.after.intendedChange` — the full change that would have been sent to the platform
- `AuditLog.meta.jobRunId`

It does not call mutation connectors and does not change recommendation status.

The cron route is dry-run by default. Live execution requires both:

- `EXECUTE_APPROVED_LIVE_ENABLED=true`
- `?live=true`

After reviewing the dry-run audit trail and confirming the approved queue is clean, run live:

```bash
curl -sf -H "Authorization: Bearer $CRON_SECRET" "https://autopilot.agrikoph.com/api/cron/execute-approved?live=true"
```

## PM2

```bash
pm2 status                          # process list
pm2 logs autopilot --lines 100      # recent logs
pm2 restart autopilot --update-env  # restart and pick up env changes
pm2 stop autopilot                  # stop (cron will fail until restarted)
pm2 start autopilot                 # start
pm2 save                            # persist process list across reboots
```

PM2 is configured to start on boot via systemd. If the VPS reboots, the app restarts automatically.

## Health Checks

```bash
# App and DB liveness
curl https://autopilot.agrikoph.com/api/health

# Job run history (requires CRON_SECRET or App Bridge session token)
curl -H "Authorization: Bearer $CRON_SECRET" https://autopilot.agrikoph.com/api/jobs/status

# Durable queued job drain
curl -H "Authorization: Bearer $CRON_SECRET" "https://autopilot.agrikoph.com/api/cron/drain-jobs?limit=1"
```

The embedded Settings page (`/settings`) shows per-connector health: last success, last error, and which credentials are sourced from DB vs env.

## Logs

```bash
# PM2 app logs (stdout/stderr)
pm2 logs autopilot --lines 200

# Cron execution log
tail -f /var/log/autopilot-cron.log

# nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

Job run history with error excerpts is also available in the embedded UI dashboard under "Job Health".

## Durable Job Queue

Manual dashboard refreshes are stored in `JobRun` with `status='queued'` and drained by `/api/cron/drain-jobs`. The production cron file should include:

```cron
* * * * * root SECRET=$(grep '^CRON_SECRET=' /opt/autopilot/.env | cut -d= -f2 | tr -d '"'); curl -sf "https://autopilot.agrikoph.com/api/cron/drain-jobs?limit=1" -H "Authorization: Bearer $SECRET" >> /var/log/autopilot-cron.log 2>&1
```

The drain endpoint claims one queued run at a time, updates heartbeat timestamps while it executes, and requeues or fails stale claimed runs based on `JOB_QUEUE_STALE_MINUTES` and `maxAttempts`.

Queue settings:

```bash
JOB_QUEUE_DRAIN_LIMIT=1
JOB_QUEUE_STALE_MINUTES=30
JOB_QUEUE_HEARTBEAT_MS=30000
```

## Retention

The daily cron runs retention cleanup after proposal generation:

- `RAW_SNAPSHOT_RETENTION_DAYS=30`
- `JOB_RUN_RETENTION_DAYS=90`

Raw snapshots with `source='seo_history'` are retained for long-term SEO trend history. Raw snapshots referenced by `Recommendation.snapshotId` are also retained even after the TTL because the Prisma relation is `onDelete: Cascade`; deleting those snapshots would delete recommendation history and execution context.

Only terminal job runs older than the TTL are deleted. Queued/running rows are left for queue recovery and health checks.

## Database

```bash
# Run from local with DATABASE_URL set
npm run db:migrate    # apply pending migrations
npm run db:report     # pg_stat_statements: connections, cache hit, top queries
npm run data:audit     # row counts, latest data timestamps, latest data-feeding job status
npm run data:duplicates # read-only duplicate logical row detail report
npm run data:dedupe     # dry-run duplicate cleanup for normalized dashboard tables
npm run dashboard:baseline -- --env .env.production --days 30
npm run dashboard:baseline:remote -- --days 30

# Direct psql on server
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
psql $DATABASE_URL
```

Keep `connection_limit=10` in `DATABASE_URL`. Add `pool_timeout=10` so connection exhaustion fails quickly instead of hanging. The server needs headroom for the web process, future workers, migrations, `psql`, and Postgres maintenance workers.

`DATABASE_URL_STRICT=true` makes the app fail fast when required URL safety settings are missing. Enable it only after confirming the production URL includes the required pool settings.

### Dashboard pipeline baseline

Before changing scheduler, queue, lock, or ingestion behavior, capture the current baseline:

```bash
npm run dashboard:baseline -- --env .env.production --days 30
npm run dashboard:baseline -- --env .env.production --days 30 --json > dashboard-baseline.json
```

This is read-only. It reports recent job status counts, latest job per name, longest jobs, active locks, freshness, and likely duplicate logical rows in append-heavy dashboard tables.

For duplicate cleanup planning, get the detailed groups and candidate keeper ids:

```bash
npm run data:duplicates -- --limit 50 --json > duplicate-ingestion-report.json
```

For production, run it through SSH so it uses the server-local DB path:

```bash
ssh root@172.105.161.83 'cd /opt/autopilot && node --input-type=module - --limit 50 --json' < scripts/duplicate-ingestion-report.mjs > duplicate-ingestion-report.json
```

This report is read-only. Do not delete duplicate rows until the corresponding ingestion path is made idempotent or the duplicates will return.

To clean duplicate logical rows before applying dashboard idempotency indexes:

```bash
npm run data:dedupe -- --env .env.production --json
npm run data:dedupe -- --env .env.production --apply --json
npm run db:migrate
```

Production should run the same sequence server-side while cron is paused and after taking a database backup. `RawSnapshot` cleanup is intentionally excluded unless `--include-raw-snapshots` is passed because deleting duplicate raw snapshots cascades to child recommendations.

Production Postgres currently listens on localhost only. Prefer the remote runner for production baselines:

```bash
npm run dashboard:baseline:remote -- --days 30 --json > dashboard-baseline.json
```

The remote runner reads SSH metadata from local `.env`, executes the baseline script on `/opt/autopilot`, and uses the server's active `.env` for DB access. It does not require opening Postgres to the public network.

For ad hoc local DB tools, use an SSH tunnel instead of changing Postgres listen rules:

```bash
ssh -L 15432:127.0.0.1:5432 root@172.105.161.83
```

Then point local tooling at `127.0.0.1:15432` with the same DB user/password as the server-side `DATABASE_URL`.

### Stale running jobs

If a process exits mid-job, `JobRun` rows can remain `status='running'` even though no process is active. Check first:

```bash
npm run jobs:stale -- --env .env.production --older-than-minutes 360
```

For production, run through SSH so the script uses the server-local database path:

```bash
ssh root@172.105.161.83 'cd /opt/autopilot && node --input-type=module - --older-than-minutes 360' < scripts/stale-job-runs.mjs
```

After confirming the rows are genuinely stale, mark them failed explicitly:

```bash
ssh root@172.105.161.83 'cd /opt/autopilot && node --input-type=module - --older-than-minutes 360 --apply' < scripts/stale-job-runs.mjs
```

The repair is intentionally narrow: it only updates `JobRun` rows that are still `running` and older than the threshold. It does not modify source data, snapshots, recommendations, or locks.

### Deploy drain

Until the pipeline has a durable queue/worker, do not deploy during active ingestion windows. Before deploying:

```bash
# Confirm no current locks
psql $DATABASE_URL -c 'select * from "JobLock" order by "lockedAt";'

# Confirm no long-running in-process jobs
psql $DATABASE_URL -c 'select id, "jobName", status, "startedAt" from "JobRun" where status = '\''running'\'' order by "startedAt";'
```

If cron is about to fire, pause the scheduler first, deploy, run the health check, then resume the scheduler.

### Backup

```bash
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
pg_dump $DATABASE_URL > /tmp/autopilot-$(date +%Y%m%d).sql
```

Copy off-server:
```bash
scp -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83:/tmp/autopilot-$(date +%Y%m%d).sql ./backups/
```

Run a backup before any migration that drops or alters large tables. There is no automated backup yet.

### Restore

```bash
psql $DATABASE_URL < autopilot-YYYYMMDD.sql
```

## Recovery Procedures

### Stuck JobLock

If a job crashed mid-run, its `JobLock` row may still be held. Locks expire automatically after 10 minutes. To clear immediately:

```bash
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
psql $DATABASE_URL -c "DELETE FROM \"JobLock\" WHERE \"jobName\" = 'fetch-ads-data';"
```

### Bad deploy (roll back app code)

The deploy removes `.next.old` at the end, so a previous build is not kept. To roll back:

```bash
ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
cd /opt/autopilot
git log --oneline -5
git checkout <commit> -- .
npm install --prefer-offline --no-audit --no-fund --cache /opt/autopilot/.npm-cache
npm run build:remote
pm2 restart autopilot --update-env
```

If the migration was destructive, restore from a DB backup taken before the deploy first.

### Ad recommendation execution rollback

If a live ad recommendation executed incorrectly:

1. **Stop further execution immediately:**
   ```bash
   ssh -i ~/.ssh/id_ed25519_autopilot root@172.105.161.83
   mv /etc/cron.d/autopilot /etc/cron.d/autopilot.disabled
   ```

2. **Find the before-state in AuditLog:**
   ```sql
   SELECT action, before, after, "createdAt"
   FROM "AuditLog"
   WHERE "entityType" = 'recommendation'
     AND "entityId" = '<rec-id>'
   ORDER BY "createdAt" ASC;
   ```
   The `execution_started` row has `before` with the platform state captured before the mutation.

3. **Reverse manually** in Meta Ads Manager using the `before` values. Roll back only the specific entity named in the audit log — do not bulk-edit related campaigns or ad sets.
   - Paused campaign/ad → set status back to active if `before` shows it was active
   - Budget change → restore the previous budget from `before`

4. **Mark the recommendation so it cannot re-execute:**
   ```sql
   UPDATE "Recommendation"
   SET status = 'failed',
       "executionResult" = '{"error": "manually reversed — see audit log"}'
   WHERE id = '<rec-id>';
   ```

5. **Re-enable cron** only after verifying the platform state is correct:
   ```bash
   mv /etc/cron.d/autopilot.disabled /etc/cron.d/autopilot
   ```

### Content Pilot publish recovery

If a publish failed mid-way, the route resets `draftStatus` back to `"ready"` on error so the operator can retry. If the process died and `draftStatus` is stuck at `"publishing"`:

```sql
UPDATE "ContentProposal"
SET "draftStatus" = 'ready'
WHERE id = '<proposal-id>';
```

### App OOM / won't start

The VPS has 2 GB RAM + 2 GB swap. Node builds are capped at `--max-old-space-size=1536`. If the process was OOM-killed:

```bash
pm2 logs autopilot --lines 50
pm2 restart autopilot
```

If a build OOM-killed during deploy, the old `.next` is still in place and PM2 restarts on it automatically. The swap file ensures future builds have enough headroom.

## Credentials

Credentials are resolved with DB-over-env precedence (`lib/config/resolver.ts`). The Settings page in the embedded UI (`/settings`) lets you add or update credentials without SSH. Encrypted `ApiCredential` rows take priority over env values when both are present.

For bootstrap or emergency access, set credentials directly in `/opt/autopilot/.env` and pick them up with:

```bash
pm2 restart autopilot --update-env
```

Never commit real credentials to the repo. The deploy script explicitly excludes all `.env` files from rsync.

## Alert Webhook

Set `ALERT_WEBHOOK_URL` in `/opt/autopilot/.env`. The app POSTs JSON to this URL on:

- cron jobs that finish with `status: "failed"` or throw
- stale scheduled jobs
- repeated partial/failed runs for the same job
- stale data streams
- stuck queued dashboard refresh jobs
- stale owned queue jobs that stop heartbeating
- expired or stale job locks

Optional alert thresholds:

```bash
ALERT_QUEUED_JOB_STALE_MINUTES=30
ALERT_RUNNING_JOB_STALE_MINUTES=30
ALERT_ACTIVE_JOB_LOCK_STALE_MINUTES=30
```

Payload includes type, timestamp, app URL, affected job/stream/lock metadata, and a sanitized error excerpt where relevant. It does not include secrets or raw external API payloads.
# Filipino content regeneration

Use the read-only scan first, then apply only an explicit bounded selection with `POST /api/content-pilot/regenerate-filipino`. The JSON body must contain `proposalIds` (1–25 unique IDs), `confirmation: "REGENERATE_FILIPINO"`, and `republishPublished` (boolean). The caller needs the `CONTENT_PUBLISH` permission; requests are rate limited. The server re-detects Filipino text and never widens an omitted selection. A `200` means all selected work completed; `207` is mixed (inspect per-item statuses and counts); `4xx` indicates the request was rejected before AI or Shopify work.
