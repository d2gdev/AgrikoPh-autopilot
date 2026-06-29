---
name: handoff
description: Generate a session handoff document for the Agriko Autopilot project. Summarises what was completed this session, current system state, open items from action.md, and what to do next.
---

# Session Handoff

Generate a structured handoff document so the next session can resume without re-discovery.

## Steps

### 1. Gather context (run in parallel)

```bash
rtk git log --oneline -10
```

```bash
rtk git diff HEAD~1 --stat
```

Read `action.md` — scan for unchecked `- [ ]` items only (skip completed `- [x]`).

Check the session conversation for any work completed this session that isn't yet committed.

### 2. Check live system state

```bash
ssh -i ~/.ssh/autopilot_deploy root@172.105.161.83 "pm2 list && tail -20 /root/.pm2/logs/autopilot-out.log"
```

Note any errors or warnings in the PM2 output.

### 3. Write the handoff

Output a markdown document with these sections — be terse, no padding:

---

```markdown
# Agriko Autopilot — Session Handoff (YYYY-MM-DD)

## Project

Next.js 14 embedded Shopify app on Linode (Ubuntu 22.04, PM2, nginx). Prisma + PostgreSQL at localhost:5432/autopilot. Deploy: `node scripts/linode-deploy.mjs`. Server: 172.105.161.83, SSH key: `~/.ssh/autopilot_deploy`. Branch: `versiion-one`.

---
## What Was Completed This Session

[Bullet list of everything completed — be specific. Reference file paths where relevant. Group by feature/phase.]

---
## Current State

[Key facts about system state right now: is execution live, last cron run status, any known errors, DB state if relevant.]

---
## Open Items (from action.md)

[List unchecked items that are still relevant, grouped by phase. Skip phases that are fully done. Carry forward Known Issues.]

---
## Known Issues

[Issues that exist but are blocked externally or deferred — e.g. GSC 403, pending manual steps.]

---
## Key Files Changed This Session

[File paths that were modified — helps orient the next session quickly.]

---
## Cron Schedule (server time = UTC)

| Time  | Job                        |
|-------|----------------------------|
| 01:00 | run-skills                 |
| 03:00 | fetch-blog-content         |
| 04:00 | fetch-seo-data             |
| 05:00 | fetch-ads-data             |
| 05:30 | fetch-market-intel         |
| 05:45 | fetch-keyword-research     |
| 06:00 | execute-approved ← live    |
| */4   | ping                       |
```

---

## Rules

- Do NOT invent state — only report what you can verify from git log, the conversation, and the PM2 check.
- If PM2 SSH check fails or times out, note that and skip that section.
- Keep the whole document under 600 words.
- Do not include the token-saving setup or tooling changes unless they were the actual focus of this session.
- Output the handoff as a raw markdown code block so the user can copy it directly.
