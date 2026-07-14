---
name: codex-agent-loop
description: Run, inspect, resume, and approve a finite local Codex implementation-plan loop without broadening authority.
last_updated: 2026-07-14T19:53:00+08:00
---

# Codex Agent Loop

Use this procedure only for an already approved Markdown implementation plan whose tasks use unique headings in the exact form `### Task <id>: <title>`.

## Start

1. Confirm `config/codex-agent-loop.json` points at the intended worktree, readable plan, additional workspace directories, finite `maxIterations`, and finite `maxAutomaticWindows`.
2. Confirm the executor sandbox is `workspace-write`, the planner sandbox is `read-only`, and the protected approval scopes remain present. If a Sol-named model is present, the controller uses `gpt-5.6-terra` at `medium` reasoning in memory instead; config files are not rewritten.
3. Put the objective in a local prompt file and run:

   ```bash
   npm run codex:loop -- start --prompt-file /absolute/path/to/prompt.md
   ```

4. Retain the returned run ID. Inspect sanitized progress with:

   ```bash
   npm run codex:loop -- status <run-id>
   ```

Private prompts, reports, decisions, stderr, state, and `events.jsonl` are stored under the returned evidence directory. Do not publish those artifacts: they may contain source or prompt material.

## Surface integrity profile

Use the fixed local-only surface audit when reviewing Campaigns, SEO Pilot,
Store Pilot, Content Pilot, Social Pilot, Market Intelligence, Growth Brief,
and Unified Report. It uses the versioned prompt and portable current-workspace
profile; do not supply a replacement prompt.

```bash
npm run codex:surface-loop -- start
npm run codex:surface-loop -- status <run-id>
npm run codex:surface-loop -- resume <run-id> [--answer-file /absolute/path/to/answer.md]
```

The controller records every pass and exits only after five consecutive clean
passes. A defect resets the counter even when it is repaired in the same pass.
The profile remains local-only: protected actions pause for explicit operator
authority, and all run evidence remains private under `.codex-agent-loop/runs/`.

When auditing an explicit UI refresh over a local response cache, test the
ordinary-in-flight → forced-refresh overlap and the late completion order. A
forced refresh must not await an ordinary in-flight promise, and older reads
must not overwrite refreshed cache data; use separate forced-flight state and
monotonic cache versions where concurrent requests are supported.

## Resume

- For an interrupted run that needs no new authority, correct the local cause and run `npm run codex:loop -- resume <run-id>`.
- For `awaiting_user`, read the exact question and approval scopes first. Put the operator's explicit answer in a file, then run:

  ```bash
  npm run codex:loop -- resume <run-id> --answer-file /absolute/path/to/answer.md
  ```

- Never reuse an answer to imply broader authority. Deployment, production access, live Shopify/Meta writes, production database changes, credential changes, destructive actions, scope expansion, strategy activation, and material judgment require their own explicit authorization.
- Reaching `automatic_window_limit` is an intentional finite safety pause; continue only with an explicit answer authorizing another bounded continuation.

## Verify Evidence

On completion, confirm public status reports the normalized `planPath`, ordered `completedTaskIds`, `cumulativeIterations`, `windows`, and completion outcome. `finalCommit` appears only when the final executor report supplies a commit identifier. In `events.jsonl`, verify each actual transition has one `plan_task_selected` or `plan_task_completed` record and the completed plan has one `plan_completed` record; resuming must not duplicate unchanged transitions.

Malformed or duplicate task headings must interrupt rather than guessing plan order. A task named “deploy” or otherwise mentioning a protected action does not authorize that action and must still pause at the boundary.
