# Surface Integrity Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one local command that audits and repairs the listed operator surfaces, and can complete only after five consecutive clean passes.

**Architecture:** Keep the existing `codex-agent-loop` controller as the only executor/planner boundary. Add one optional, generic audit-pass contract to its structured execution report and state; the dedicated surface profile turns that contract on with `requiredCleanPasses: 5`. A small wrapper selects the fixed prompt and portable profile so operators run `npm run codex:surface-loop -- start`, `status`, or `resume` without using the stale default worktree configuration.

**Tech Stack:** Node.js ESM, Codex CLI structured JSON output, JSON configuration, Markdown prompt, Vitest, TypeScript test runner.

## Global Constraints

- Local code, UI, persistence, tests, and project-record changes are authorized; production access, deployment, live Shopify/Meta writes, strategy activation, production database changes, credential/permission changes, and destructive work remain protected approval boundaries.
- The topical map governs only SEO Pilot, Content Pilot, and governed Store Pilot work; do not apply it to ads, social, market intelligence, or reports.
- A pass with any defect is unclean even if fixed in that pass; it resets the counter to zero.
- Completion requires at least five uninterrupted clean passes after the last defect.
- Use no new npm dependencies and do not change application API, Prisma schema, Shopify/Meta execution, or product UI as part of the loop infrastructure.

---

### Task 1: Enforce the reusable clean-pass completion gate

**Files:**
- Modify: `scripts/codex-agent-loop.mjs`
- Modify: `config/codex-agent-loop/execution-report.schema.json`
- Create: `__tests__/scripts/codex-agent-loop.test.ts`

**Interfaces:**
- Consumes: optional controller config `requiredCleanPasses: number`, defaulting to `0` for existing loop behavior.
- Consumes: executor report field `audit_pass`, `null` for ordinary runs or `{ clean: boolean; defects: string[]; fixes: string[]; verification: string[] }` for audit-profile runs.
- Produces: durable state fields `consecutiveCleanPasses: number` and `auditPassLedger: Array<{ iteration: number; clean: boolean; defects: string[]; fixes: string[]; verification: string[] }>`.
- Produces: a hard completion invariant: when `requiredCleanPasses > 0`, a planner `done` decision is accepted only if `consecutiveCleanPasses >= requiredCleanPasses`.

- [ ] **Step 1: Write the failing controller subprocess tests**

Create a Vitest file that uses a temporary directory, writes a minimal config and a fake `codex` executable, and invokes the controller with `spawnSync`. The fake executable receives the controller prompt and writes its queued JSON response to the `-o` path. Add these assertions:

```ts
expect(completed.status).toBe("completed");
expect(finalState.consecutiveCleanPasses).toBe(5);
expect(finalState.auditPassLedger).toHaveLength(5);

expect(resetState.consecutiveCleanPasses).toBe(1);
expect(resetState.auditPassLedger.map((pass) => pass.clean)).toEqual([true, true, false, true]);

expect(earlyDone.status).toBe("interrupted");
expect(earlyDone.reason).toContain("5 clean passes");
```

Use a clean executor report payload shaped as:

```json
{
  "status": "complete",
  "outcome": "Pass clean.",
  "approval_required": false,
  "approval_question": null,
  "blockers": [],
  "recommended_next_step": "Continue the audit loop.",
  "audit_pass": { "clean": true, "defects": [], "fixes": [], "verification": ["focused tests passed"] },
  "runtime_impact": { "production_accessed": false, "deployed": false, "live_changes_made": false }
}
```

Use an unclean report with `clean: false`, one defect, its local fix, and verification evidence. The five-clean sequence returns planner `run` for passes 1–4 and `done` only after pass 5.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: FAIL because the current controller has no `audit_pass` contract, clean-pass state, or completion gate.

- [ ] **Step 3: Extend the report schema and validation minimally**

In `config/codex-agent-loop/execution-report.schema.json`, add required nullable `audit_pass`:

```json
"audit_pass": {
  "type": ["object", "null"],
  "required": ["clean", "defects", "fixes", "verification"],
  "properties": {
    "clean": { "type": "boolean" },
    "defects": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "fixes": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "verification": { "type": "array", "items": { "type": "string", "minLength": 1 } }
  },
  "additionalProperties": false
}
```

In `scripts/codex-agent-loop.mjs`, make `validateReport(report, requiredCleanPasses)` require a non-null audit pass when `requiredCleanPasses > 0`; reject `clean: true` when `defects` or `fixes` is non-empty; reject `clean: false` when `defects` is empty; and require non-empty verification for every audit pass. Keep `audit_pass: null` valid for the default controller profile.

- [ ] **Step 4: Persist the counter and reject premature completion**

Normalize `requiredCleanPasses` in `loadConfig` as a non-negative integer with a default of `0`. Initialize this exact state:

```js
consecutiveCleanPasses: 0,
auditPassLedger: [],
```

Immediately after a valid executor report, append an immutable plain-object ledger entry. Update the count with:

```js
state.consecutiveCleanPasses = report.audit_pass.clean
  ? state.consecutiveCleanPasses + 1
  : 0;
```

Before accepting `state.lastDecision.action === "done"`, enforce:

```js
if (config.requiredCleanPasses > 0 && state.consecutiveCleanPasses < config.requiredCleanPasses) {
  state.status = "interrupted";
  state.result = { reason: `Planner attempted completion before ${config.requiredCleanPasses} clean passes.` };
  saveState(layout, state);
  appendEvent(layout, state, "clean_pass_gate_rejected", state.result);
  return publicStatus(layout, state);
}
```

Extend `executorPrompt` and `plannerPrompt` only when the profile is enabled. Require the executor to populate `audit_pass`, and tell the planner the current count, the fixed requirement, and that `done` is prohibited before the requirement is met.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
npx vitest run __tests__/scripts/codex-agent-loop.test.ts
node -e 'JSON.parse(require("fs").readFileSync("config/codex-agent-loop/execution-report.schema.json", "utf8"))'
git diff --check
```

Expected: the focused suite passes, the schema parses, and the diff check produces no output.

Commit:

```bash
git add scripts/codex-agent-loop.mjs config/codex-agent-loop/execution-report.schema.json __tests__/scripts/codex-agent-loop.test.ts
git commit -m "feat(agent-loop): require consecutive clean audit passes"
```

### Task 2: Add the portable surface-audit profile and operator command

**Files:**
- Create: `config/codex-surface-loop.json`
- Create: `config/codex-agent-loop/prompts/surface-integrity.md`
- Create: `scripts/codex-surface-loop.mjs`
- Modify: `package.json`
- Modify: `__tests__/scripts/codex-agent-loop.test.ts`

**Interfaces:**
- Consumes: the existing controller CLI and the Task 1 audit contract.
- Produces: `npm run codex:surface-loop -- start`, `npm run codex:surface-loop -- status <run-id>`, and `npm run codex:surface-loop -- resume <run-id> [--answer-file <path>]`.
- Produces: profile config rooted at `.` with `requiredCleanPasses: 5`, `maxIterations: 30`, the existing 60-minute timeout, `workspace-write` executor, `read-only` planner, and every existing protected approval scope.

- [ ] **Step 1: Add failing profile/wrapper tests**

Extend the Task 1 test file with static profile assertions and one usage subprocess. Assert that the wrapper source resolves the dedicated config and prompt for `start`, forwards the remaining command arguments, and has no reference to `.worktrees/feat-topical-map-strategy-persistence`. Run `node scripts/codex-surface-loop.mjs --help` and assert it exits successfully with start/status/resume usage; this does not start a Codex run.

```ts
expect(invocation).toContain("config/codex-surface-loop.json");
expect(invocation).toContain("config/codex-agent-loop/prompts/surface-integrity.md");
expect(invocation).not.toContain(".worktrees/feat-topical-map-strategy-persistence");
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: FAIL because the dedicated command, config, and prompt do not exist.

- [ ] **Step 3: Create the dedicated profile and prompt**

Create `config/codex-surface-loop.json` with the existing model/sandbox/protected-scope values, but use portable root-relative paths:

```json
{
  "workingDirectory": ".",
  "additionalDirectories": ["../shopify-theme"],
  "maxIterations": 30,
  "timeoutMinutes": 60,
  "requiredCleanPasses": 5
}
```

Include the complete executor/planner settings and all nine existing protected scopes verbatim. Do not edit `config/codex-agent-loop.json`.

Create `config/codex-agent-loop/prompts/surface-integrity.md`. It must enumerate every requested surface, run the five audit lenses from the approved spec, distinguish topical-map-governed surfaces from the others, require local test-first fixes, forbid protected actions, require a pass ledger in every report, and state that an unclean pass resets the counter.

- [ ] **Step 4: Implement the thin command wrapper**

Create `scripts/codex-surface-loop.mjs`. Resolve the project root from `import.meta.url`, validate the first argument is exactly `start`, `status`, or `resume`, then spawn the existing controller with Node and a fixed `--config` path. For `start`, inject the fixed `--prompt-file` path and reject a caller-provided `--prompt-file`. For `status` and `resume`, do not inject the prompt. Forward stdio and exit with the child status.

Add exactly this package script:

```json
"codex:surface-loop": "node scripts/codex-surface-loop.mjs"
```

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
npx vitest run __tests__/scripts/codex-agent-loop.test.ts
npm run codex:surface-loop -- --help
node -e 'JSON.parse(require("fs").readFileSync("config/codex-surface-loop.json", "utf8"))'
git diff --check
```

Expected: focused tests and JSON parsing pass; the wrapper prints its start/status/resume usage without starting a run; diff check produces no output.

Commit:

```bash
git add config/codex-surface-loop.json config/codex-agent-loop/prompts/surface-integrity.md scripts/codex-surface-loop.mjs package.json __tests__/scripts/codex-agent-loop.test.ts
git commit -m "feat(agent-loop): add surface integrity command"
```

### Task 3: Record the repeatable workflow and verify the completed command

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/architecture.md`
- Modify: `.mex/patterns/codex-agent-loop.md`
- Modify: `docs/planning-metrics.csv`

**Interfaces:**
- Consumes: the verified Task 1 completion gate and Task 2 command profile.
- Produces: current project context and a repeatable operator procedure that documents the five-clean-pass contract and protected approval pauses.

- [ ] **Step 1: Update GROW records concisely**

Add one current-state entry to `.mex/ROUTER.md` stating the command is a local-only controller profile, resets on defects, and completes only after five clean passes. Add the same boundary to `.mex/context/architecture.md`. Extend `.mex/patterns/codex-agent-loop.md` with the exact start, status, and resume commands for `codex:surface-loop`, including that its prompt is fixed and private evidence remains unpublishable. Bump each changed scaffold frontmatter `last_updated` to `2026-07-14`.

Append this row to `docs/planning-metrics.csv`:

```csv
2026-07-14,surface-integrity-loop,lean,1,0.5,0,Minimal controller profile and five-clean-pass gate; user explicitly requested no over-engineering
```

- [ ] **Step 2: Run the complete local verification**

Run:

```bash
npx vitest run __tests__/scripts/codex-agent-loop.test.ts
npm run typecheck
npm run typecheck:test
npm run lint
node -e 'for (const p of ["config/codex-agent-loop/execution-report.schema.json", "config/codex-surface-loop.json"]) JSON.parse(require("fs").readFileSync(p, "utf8"));'
test "$(rg -n "dangerously-bypass-approvals-and-sandbox|dangerously-bypass" scripts/codex-agent-loop.mjs scripts/codex-surface-loop.mjs config/codex-surface-loop.json | wc -l)" -eq 1
git diff --check
```

Expected: focused tests and both type checks pass; lint has zero errors; both JSON files parse; the only dangerous-bypass match is the existing controller guard that rejects such arguments; diff check produces no output. Report unchanged lint warnings by exact count if any remain.

- [ ] **Step 3: Review scope and commit**

Confirm the diff has no changes to application API routes, Prisma schema, Shopify/Meta execution, deployment configuration, or production credentials. Run `mex log --type decision "Added a local-only five-clean-pass surface integrity loop profile."` if `mex` is available.

Commit:

```bash
git add .mex/ROUTER.md .mex/context/architecture.md .mex/patterns/codex-agent-loop.md docs/planning-metrics.csv __tests__/scripts/codex-agent-loop.test.ts
git commit -m "docs: record surface integrity loop workflow"
```
