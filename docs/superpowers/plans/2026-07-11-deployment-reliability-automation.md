# Deployment Reliability Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Make `scripts/git-deploy.mjs` return only after the remote build swap, PM2 restart, and health checks conclusively succeed or fail.

**Architecture:** Extract a pure deploy-observation contract that compares expected commit/build/process/health evidence. Keep SSH and credentials in the existing deploy script; add bounded polling after the remote command and persist only redacted diagnostics.

**Tech Stack:** Node.js, existing `scripts/git-deploy.mjs`, Vitest.

## Global Constraints

- Preserve atomic `.next.build` → `.next` swapping and `.next.old` rollback.
- Never print credentials, process environments, or raw remote secrets.
- A deploy is successful only when expected commit, new build artifact, restarted PM2 process, and public health are observed.
- Do not run production actions in tests.

### Task 1: Deploy observation contract

**Files:**
- Create: `scripts/deploy-observation.mjs`
- Create: `__tests__/scripts/deploy-observation.test.ts`

- [ ] Write failing tests for a pending remote build, a completed release, a stale PM2 process, and a health failure.
- [ ] Implement `parseDeploymentObservation(output)` and `isDeploymentComplete(observation, expected)` with only commit SHA, build timestamp, process start timestamp, and health status fields.
- [ ] Run `npm test -- __tests__/scripts/deploy-observation.test.ts` and commit `test: define deploy completion evidence`.

### Task 2: Deterministic remote completion marker

**Files:**
- Modify: `scripts/git-deploy.mjs`
- Test: `__tests__/scripts/git-deploy-policy.test.ts`

- [ ] Write a failing policy test requiring the remote script to print one JSON completion marker only after build, migration, atomic swap, PM2 restart, and retrying health check.
- [ ] Make the remote script emit a redacted marker containing `commit`, `buildIdMtime`, `pm2StartedAt`, and `healthStatus`; make the local script parse it and fail if absent.
- [ ] Run the focused deploy tests and commit `fix: require deploy completion evidence`.

### Task 3: Bounded deploy polling and recovery record

**Files:**
- Modify: `scripts/git-deploy.mjs`
- Create: `__tests__/scripts/git-deploy-observation.test.ts`
- Modify: `.mex/patterns/deploy.md`

- [ ] Write failing tests for polling success, timeout, and a remote checkout that advances without a matching build/restart.
- [ ] Add bounded polling with a 90-second deadline and 3-second interval; on timeout print only the redacted observed state and leave the rollback artifact untouched.
- [ ] Document the marker and polling contract in the deploy pattern.
- [ ] Run focused tests, `npm test`, typechecks, lint, build, and `git diff --check`; commit `fix: make deploy completion observable`.
