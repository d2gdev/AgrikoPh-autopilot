---
name: deployment
description: Deploy procedure, server layout, PM2, cron, and env management
metadata:
  type: project
---

# Deployment

## Deploy command

```bash
node scripts/linode-deploy.mjs
```

Atomic swap: builds locally, rsync to `/opt/autopilot-next/`, symlink swap to `/opt/autopilot/`, PM2 reload.

## Server

- IP: `172.105.161.83` · User: `root`
- SSH: `ssh -i ~/.ssh/autopilot_deploy root@172.105.161.83`
- App dir: `/opt/autopilot/`
- Env file: `/opt/autopilot/.env`
- PM2: `pm2 logs autopilot --lines 50` / `pm2 restart autopilot`
- Nginx proxies `:80/:443` → `:3000`

## Cron

Single source: `/etc/cron.d/autopilot`. Reads `CRON_SECRET` from `.env`. No personal crontab entries.

## Updating .env on server

SSH in and edit `/opt/autopilot/.env` directly, then `pm2 restart autopilot`. Credentials stored in DB via `ApiCredential` take effect immediately without restart (resolver queries DB on every request).

## Branch → deploy flow

Work on `versiion-one` → commit → `node scripts/linode-deploy.mjs`.
PR to `main` when feature is stable.

## TypeScript check before deploy

```bash
npx tsc --noEmit
```
