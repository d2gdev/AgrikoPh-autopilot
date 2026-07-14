---
name: deploy
description: Deploying to the Linode VPS production server and managing environment config changes in production.
triggers:
  - "deploy"
  - "production"
  - "linode"
  - "vps"
  - "pm2"
  - "env var in prod"
  - "rollback"
edges:
  - target: context/setup.md
    condition: for environment variable reference
  - target: context/decisions.md
    condition: for why the self-hosted VPS approach was chosen
  - target: patterns/debug-pipeline.md
    condition: if a deploy breaks the pipeline
last_updated: 2026-07-14T16:11:19+08:00
---

# Deploy

## Context

Production runs on a Linode VPS at `https://autopilot.agrikoph.com`. The app is a persistent Node.js process managed by PM2 behind nginx + certbot TLS. Deployment is via git fetch/pull over SSH using `scripts/git-deploy.mjs`. Access: `ssh autopilot-prod` (passwordless key auth).

App directory on server: `/opt/autopilot`

## Task: Deploy Code Changes

### Steps

1. Ensure all tests pass locally: `npm test`
2. Build locally to catch type errors: `npm run build` (or `npm run build:remote` for remote-target build)
3. Run the deploy script:
   ```bash
   node scripts/git-deploy.mjs
   ```
   This requires a clean working tree, pushes local `main` to origin, fetches `main` in `/opt/autopilot`, builds remotely before applying migrations, swaps `.next` atomically, and restarts via PM2. An emergency branch requires both `--branch <name>` and `--allow-non-main`.
4. Verify the deploy:
   ```bash
   ssh autopilot-prod "pm2 status"
   ssh autopilot-prod "pm2 logs autopilot --lines 50"
   ```
5. Hit the health check: `curl https://autopilot.agrikoph.com/api/health`
6. If the deploy included a schema change: run migrations on the server (see below)

### Gotchas

- PM2 sends SIGTERM before killing the process. `server.js` handles this — allow up to 10 seconds for graceful shutdown. Do not force-kill unless the process is genuinely hung.
- If `server.js` fails the required-env-vars check on startup, PM2 will loop-restart. Check `pm2 logs autopilot` immediately after deploy.
- `npm run build:local` and `npm run build:remote` differ in how Prisma is generated — deploy uses `build:remote` on the VPS.
- `scripts/git-deploy.mjs` reads `GITHUB_TOKEN` from local env / `.env`, uses temporary mode-0700 `GIT_ASKPASS` helpers, and sends the remote credential through encrypted SSH stdin. Do not put tokens in Git config arguments, SSH command arguments, remotes, or scripts.
- SSH host-key verification must remain enabled. Verify and save the VPS fingerprint in `~/.ssh/known_hosts` before the first deploy; never add `StrictHostKeyChecking=no`.
- The deploy build must finish before `npm run db:migrate`. The script keeps `.next.old` through a retrying post-restart health check and restores it if PM2 startup or health verification fails; migrations still need expand/contract compatibility because there are no down migrations.
- Keep the server-owned `/opt/autopilot/google-ads-service-account.json` excluded from both Git tracking and `git clean`. Production `GA_SERVICE_ACCOUNT_JSON[_PATH]` points to that file; deleting it makes Keyword Research and aggregate Dashboard Refresh runs report `partial` without a connector error.
- Legacy `scripts/linode-deploy.mjs` still exists as an rsync fallback, but should not be the default deploy path.

## Task: Run Database Migrations in Production

### Steps

1. SSH to the server: `ssh autopilot-prod`
2. Change to app directory: `cd /opt/autopilot`
3. Run migrations: `npm run db:migrate`
   - This runs `prisma migrate deploy` against the production `DATABASE_URL`
4. If Prisma client needs regenerating after a schema change: `npm run db:generate`
5. Restart the app so it picks up the new client: `pm2 restart autopilot`

### Gotchas

- `prisma migrate deploy` applies all pending migrations — it does NOT interactively create new ones. Never run `prisma migrate dev` in production.
- Migrations that add NOT NULL columns require a default or a two-step migration (add nullable → backfill → add constraint). Check `prisma/migrations/` for examples.
- Unique constraint changes: use `DROP CONSTRAINT` not `DROP INDEX` for constraint-backed indexes — see git history for past migration fixes.
- If a migration fails mid-way, Prisma marks it as failed in `_prisma_migrations`. You may need to manually resolve and mark it applied before retrying.

## Task: Update Environment Variables in Production

### Steps

1. SSH to the server: `ssh autopilot-prod`
2. Edit the env file: `nano /opt/autopilot/.env`
3. Make the change and save
4. Restart the app: `pm2 restart autopilot`
5. Verify it started cleanly: `pm2 logs autopilot --lines 30`

### Gotchas

- `server.js` validates required env vars on startup and exits if any are missing. Adding a new required var here means adding it to both `.env.example` (committed) and the production `.env` (on the server).
- `EXECUTE_APPROVED_LIVE_ENABLED` defaults to `false`. Only set to `true` in production after the dry-run queue has been reviewed and is clean.
- Never put secrets in `NEXT_PUBLIC_*` variables — they get embedded in the client bundle.

## Rollback

The deploy script keeps `.next.old` through PM2 restart and post-restart health verification, restoring it automatically if either fails. For a failure discovered after successful health verification:
1. `git revert` the offending commit and re-deploy, or
2. On the server: `git fetch origin`, `git checkout [previous-sha]` in `/opt/autopilot`, run `npm run build:remote`, then `pm2 restart autopilot`

For database rollbacks: there is no automated down migration. If a migration needs to be reversed, write a new migration that undoes the change.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if the deploy changed what is working
- [ ] Update `context/setup.md` if new env vars were added
