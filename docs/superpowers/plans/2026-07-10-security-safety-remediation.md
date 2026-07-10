# Security and Safety Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove browser credential exposure, enforce the live-write gate at the execution boundary, secure deployment credentials and rollback, require reset secrets in headers, and rotate affected production credentials safely.

**Architecture:** Browser requests authenticate only with App Bridge tokens. Live execution and deployment safety are enforced in shared lower-level boundaries rather than relying on callers, while credential rotation occurs only after the remediated build passes production health and authenticated-API checks.

**Tech Stack:** Next.js 15, TypeScript, Prisma, Vitest, Node.js ESM scripts, PM2, SSH, Shopify App Bridge.

## Global Constraints

- Never execute Meta or Shopify content/ad writes during verification.
- Live recommendation execution requires explicit intent and `EXECUTE_APPROVED_LIVE_ENABLED=true` inside `executeApprovedHandler`.
- `AUTOPILOT_API_KEY` remains server-side only; no `NEXT_PUBLIC_AUTOPILOT_API_KEY` reference may remain.
- Production rollback artifacts remain until health succeeds.
- Credentials must not appear in command arguments, logs, committed files, or assistant output.
- No database schema change.

---

### Task 1: Remove the browser API-key fallback

**Files:**
- Modify: `__tests__/hooks/use-auth-fetch.test.ts`
- Modify: `hooks/use-auth-fetch.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Shopify App Bridge `idToken()` and launch `id_token`.
- Produces: `useAuthFetch()` requests authenticated only through `Authorization: Bearer <session-token>`.

- [ ] **Step 1: Write failing client-auth regressions**

Replace public-fallback expectations with tests that stub `NEXT_PUBLIC_AUTOPILOT_API_KEY` and still assert:

```ts
expect(headers["x-autopilot-api-key"]).toBeUndefined();
expect(mockIdToken).toHaveBeenCalled();
expect(headers.Authorization).toBe(`Bearer ${token}`);
```

Add a source regression asserting `hooks/use-auth-fetch.ts` does not contain `NEXT_PUBLIC_AUTOPILOT_API_KEY`.

- [ ] **Step 2: Verify RED**

Run `npm test -- __tests__/hooks/use-auth-fetch.test.ts`.

Expected: current fallback tests fail because the public key is still attached and App Bridge is skipped.

- [ ] **Step 3: Implement the minimal removal**

Delete `getPublicAutopilotApiKey`, the ready-state shortcut, fallback header injection, 401 retry, and fallback logging. Keep the existing bounded App Bridge token request and return the first authenticated response.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 test command. Expected: pass.

### Task 2: Enforce live execution inside the handler

**Files:**
- Modify: `__tests__/jobs/execute-approved.test.ts`
- Modify: `__tests__/api/cron-execute-approved-route.test.ts`
- Modify: `jobs/execute-approved.ts`
- Modify: `app/api/cron/execute-approved/route.ts`
- Modify: `app/api/recommendations/dry-run/route.ts`

**Interfaces:**
- Produces: `resolveExecutionMode(liveRequested: boolean): { dryRun: boolean; liveEnabled: boolean }` and `executeApprovedHandler({ liveRequested?, triggeredBy? })`.
- Consumes: `EXECUTE_APPROVED_LIVE_ENABLED` only inside the shared resolver.

- [ ] **Step 1: Write failing execution-boundary tests**

Add cases proving omitted options and `{ liveRequested: true }` with the environment flag unset never call the connector. Update intentional live tests to use:

```ts
vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
await executeApprovedHandler({ liveRequested: true });
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- __tests__/jobs/execute-approved.test.ts __tests__/api/cron-execute-approved-route.test.ts
```

Expected: default/direct handler calls currently execute live.

- [ ] **Step 3: Implement the lower-level gate**

Use:

```ts
export function resolveExecutionMode(liveRequested = false) {
  const liveEnabled = process.env.EXECUTE_APPROVED_LIVE_ENABLED === "true";
  return { liveEnabled, dryRun: !(liveRequested && liveEnabled) };
}
```

The handler derives `dryRun` from this resolver; the cron passes only URL intent. The dry-run route omits live intent.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 command. Expected: pass.

### Task 3: Remove deployment credentials from argv and health-gate rollback

**Files:**
- Modify: `__tests__/scripts/git-deploy-policy.test.ts`
- Modify: `scripts/git-deploy-policy.mjs`
- Modify: `scripts/git-deploy.mjs`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Produces: temporary local and remote askpass helpers; token delivery over environment/stdin; remote health polling before rollback cleanup.
- Consumes: existing `GITHUB_TOKEN`, SSH key selection, and health endpoint.

- [ ] **Step 1: Write failing deploy-source tests**

Assert the deploy source contains `GIT_ASKPASS`, `GIT_TERMINAL_PROMPT`, SSH `input`, a health retry loop, and rollback after health failure. Assert it does not contain `http.extraHeader`, `GITHUB_AUTH_HEADER`, or token interpolation in `remoteScript`.

- [ ] **Step 2: Verify RED**

Run `npm test -- __tests__/scripts/git-deploy-policy.test.ts`.

Expected: current source still contains authorization headers in argv and deletes rollback before health.

- [ ] **Step 3: Implement secure local Git authentication**

Create a mode-0700 temporary askpass script that prints `x-access-token` for username prompts and `GITHUB_TOKEN` for password prompts. Pass its path and token only via `spawnSync` environment, set `GIT_TERMINAL_PROMPT=0`, and remove it in `finally`.

- [ ] **Step 4: Implement secure remote fetch authentication**

Pass the token through SSH stdin. The remote script reads one line without echo, creates/traps a temporary askpass script, fetches, and unsets the token before build output begins.

- [ ] **Step 5: Implement health-gated rollback**

Poll `https://autopilot.agrikoph.com/api/health` after PM2 start. On failure restore `.next.old`, restart PM2 best-effort, and exit non-zero. Delete `.next.old` only after a successful health response.

- [ ] **Step 6: Verify GREEN**

Run the Task 3 test and `node --check` for both deployment scripts. Expected: pass.

### Task 4: Require destructive reset credentials in headers

**Files:**
- Modify: `__tests__/api/market-intelligence-reset-route.test.ts`
- Modify: `app/api/market-intelligence/reset/route.ts`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Consumes: `X-Maintenance-Secret` and `X-Maintenance-Confirm` headers only.
- Produces: 400 rejection for legacy query credentials and unchanged authenticated reset behavior with headers.

- [ ] **Step 1: Write failing route regressions**

Change success requests to headers and add:

```ts
const response = await postResetRoute(
  request("/api/market-intelligence/reset?maintenanceSecret=secret&confirm=token"),
);
expect(response.status).toBe(400);
expect(mockPrisma.marketInsight.deleteMany).not.toHaveBeenCalled();
```

- [ ] **Step 2: Verify RED**

Run `npm test -- __tests__/api/market-intelligence-reset-route.test.ts`.

Expected: URL credentials are currently accepted.

- [ ] **Step 3: Implement headers-only credentials**

Remove URL parameter resolution. Reject requests containing `maintenanceSecret`, `confirm`, or `token` parameters before comparing header values.

- [ ] **Step 4: Verify GREEN**

Run the Task 4 test command. Expected: pass.

### Task 5: Verify, document, commit, and deploy

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/patterns/deploy.md`
- Modify: `.mex/events/decisions.jsonl` through `mex log`.

**Interfaces:**
- Produces: verified local `main`, updated runbooks, and a deployed remediated build before credential rotation.

- [ ] **Step 1: Run complete local verification**

Run:

```bash
npm run typecheck
npm run typecheck:test
npm test
npm run build
node --check scripts/git-deploy.mjs
node --check scripts/git-deploy-policy.mjs
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Run GROW and commit**

Update current state and deployment runbook, bump `last_updated`, log the security decision, commit task-scoped files, and push `main`.

- [ ] **Step 3: Deploy before rotating credentials**

Run `node scripts/git-deploy.mjs`, verify the public health endpoint and an authenticated embedded API request, and stop without rotation if either fails.

### Task 6: Rotate local and production credentials

**Files:**
- Modify operationally, not commit: `.env`, `.env.production`, `/opt/autopilot/.env`.

**Interfaces:**
- Produces: new server-only `AUTOPILOT_API_KEY`, no public API-key variable, and rotated reset secrets when configured.

- [ ] **Step 1: Generate replacement secrets without printing them**

Use Node `crypto.randomBytes(32).toString("hex")` for the API key and each configured reset secret.

- [ ] **Step 2: Update local configuration securely**

Replace `AUTOPILOT_API_KEY`, remove `NEXT_PUBLIC_AUTOPILOT_API_KEY`, and rotate configured reset secrets in both local env files without logging values.

- [ ] **Step 3: Update production over encrypted SSH stdin**

Send replacement values through SSH stdin to a remote Node process that edits `/opt/autopilot/.env` without echoing secrets. Remove the public variable and restart PM2 with `--update-env`.

- [ ] **Step 4: Verify post-rotation behavior**

Confirm public health, authenticated embedded API access, cron authentication, and rejection of the old API key. Rebuild local assets after removing the public variable and verify no source reference remains.
