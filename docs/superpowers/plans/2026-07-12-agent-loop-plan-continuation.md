# Agent Loop Plan Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Codex agent-loop automatically execute each next incomplete task in one approved implementation plan while retaining finite safety ceilings and all protected approval gates.

**Architecture:** Extend the existing single-file Node controller with validated plan-aware configuration and durable progress fields. Sol remains the read-only sequencer: it inspects the configured plan and repository evidence, emits one bounded Terra task at a time, and may finish only when the whole plan is complete. The controller rolls iteration windows automatically but pauses after a finite configured number of windows or at any existing protected boundary.

**Tech Stack:** Node.js ESM, Codex CLI structured outputs, JSON configuration, Vitest, TypeScript test runner.

## Global Constraints

- The plan file is the durable scope boundary; models may not add deliverables or infer new authority.
- Execute one bounded plan task or explicitly named subtask per Terra iteration.
- Preserve all existing protected approval scopes and Codex sandboxing.
- Never automatically deploy, access production, activate strategy, write live Shopify/Meta state, change production databases, change credentials/permissions, or perform destructive actions.
- Keep a finite `maxAutomaticWindows` ceiling; do not create an unbounded retry loop.
- Preserve existing single-objective behavior when `autoContinuePlan` is false.
- Use no new npm dependency.

---

### Task 1: Validate plan-aware workflow configuration

**Files:**
- Modify: `scripts/codex-agent-loop.mjs`
- Modify: `config/codex-agent-loop.json`
- Create: `__tests__/scripts/codex-agent-loop.test.ts`

**Interfaces:**
- Consumes: existing `loadConfig(path)` and configured workspace paths.
- Produces: normalized config fields `autoContinuePlan: boolean`, `planPath: string | null`, and `maxAutomaticWindows: number`; helper `isWithinReadableWorkspace(path, config): boolean`.

- [ ] **Step 1: Write failing configuration tests**

Create a controller subprocess harness using `spawnSync(process.execPath, [controllerPath, ...args])` and temporary configs. Add cases proving:

```ts
expect(result.status).toBe(1);
expect(parsed.outcome).toContain("planPath is required when autoContinuePlan is true");

expect(outside.outcome).toContain("Plan path must be inside a configured workspace");
expect(missing.outcome).toContain("Plan file does not exist");
expect(badCeiling.outcome).toContain("maxAutomaticWindows must be positive");
```

Also prove a config with `autoContinuePlan: false` and no plan path passes config validation far enough to reach the deliberately supplied fake Codex executable.

- [ ] **Step 2: Run the tests and verify red**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: FAIL because plan-aware fields are not validated.

- [ ] **Step 3: Implement normalized path and config validation**

In `loadConfig`, default `autoContinuePlan` to `false`. When true, require `planPath`, resolve relative paths beneath `workingDirectory`, require a regular readable file, and reject lexical or real-path escape from `[workingDirectory, ...additionalDirectories]`. Require positive integer `maxAutomaticWindows`. Return a copied normalized config rather than mutating parsed JSON.

Use path containment with a separator boundary:

```js
function pathWithin(candidate, root) {
  const relative = relativePath(realpathSync(root), realpathSync(candidate));
  return relative === "" || (!relative.startsWith("..") && !isAbsolute(relative));
}
```

Import `realpathSync`, `statSync`, and `relative as relativePath`. Reject directories at `planPath`.

- [ ] **Step 4: Enable the topical-map workflow configuration**

Add:

```json
"autoContinuePlan": true,
"planPath": "docs/superpowers/plans/2026-07-12-topical-map-strategy-package.md",
"maxAutomaticWindows": 10
```

Keep `maxIterations: 30` as the per-window ceiling and retain every protected scope unchanged.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: PASS.

Run: `git diff --check`

Commit:

```bash
git add scripts/codex-agent-loop.mjs config/codex-agent-loop.json __tests__/scripts/codex-agent-loop.test.ts
git commit -m "feat(agent-loop): validate plan continuation config"
```

### Task 2: Persist plan progress and constrain planner decisions

**Files:**
- Modify: `scripts/codex-agent-loop.mjs`
- Modify: `config/codex-agent-loop/planner-decision.schema.json`
- Modify: `__tests__/scripts/codex-agent-loop.test.ts`

**Interfaces:**
- Consumes: normalized `config.planPath`, original objective, latest report, and repository state available to Sol.
- Produces: state fields `planPath`, `currentTaskId`, `completedTaskIds`, `cumulativeIterations`, and `windowNumber`; planner decision fields `current_task_id` and `completed_task_ids`.

- [ ] **Step 1: Add failing state and prompt tests**

Use a fake Codex executable that reads stdin, writes schema-valid JSON to the path supplied after `-o`, and records prompts. Assert a new plan-aware run initializes:

```ts
expect(state.planPath).toBe(realPlanPath);
expect(state.currentTaskId).toBeNull();
expect(state.completedTaskIds).toEqual([]);
expect(state.cumulativeIterations).toBe(1);
expect(state.windowNumber).toBe(1);
```

Assert the Sol prompt includes the exact normalized plan path, the instruction `Select only the next incomplete task in plan order`, protected scopes, and `Do not return done while any approved plan task remains incomplete`.

Add a validation test rejecting `done` when its `completed_task_ids` omit a task identifier supplied by the test plan fixture.

- [ ] **Step 2: Run focused tests and verify red**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: FAIL on missing progress fields and planner contract.

- [ ] **Step 3: Extend the planner decision contract**

Add required schema properties:

```json
"current_task_id": { "type": ["string", "null"] },
"completed_task_ids": { "type": "array", "items": { "type": "string", "minLength": 1 } }
```

Validate both fields in `validateDecision`. For `run`, require a non-empty `current_task_id`; for `done`, require `current_task_id: null`.

- [ ] **Step 4: Persist progress and build a plan-aware Sol prompt**

Initialize the new state fields in `createState`. Increment `cumulativeIterations` whenever an executor turn starts. After a valid planner decision, copy `current_task_id` and a deduplicated `completed_task_ids` into state.

Extend `plannerPrompt` with:

```text
Approved implementation plan: <normalized path>
Current bounded task: <id or none>
Recorded completed tasks: <JSON array>
Select only the next incomplete task in plan order. Confirm completion from repository and verification evidence, not checkboxes alone. Do not return done while any approved plan task remains incomplete. A plan entry does not grant protected authority.
```

For non-plan runs, preserve the current prompt text and decision behavior.

- [ ] **Step 5: Add deterministic plan completion validation**

Parse task identifiers only from Markdown headings matching `### Task <identifier>:`. At a plan-aware `done` decision, compare that ordered identifier set with `completed_task_ids`. Reject missing or unknown identifiers as an invalid planner decision so the run interrupts rather than falsely completes. Do not edit the plan file or trust checkbox state.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: PASS.

Commit:

```bash
git add scripts/codex-agent-loop.mjs config/codex-agent-loop/planner-decision.schema.json __tests__/scripts/codex-agent-loop.test.ts
git commit -m "feat(agent-loop): persist approved plan progress"
```

### Task 3: Roll iteration windows automatically with a finite ceiling

**Files:**
- Modify: `scripts/codex-agent-loop.mjs`
- Modify: `__tests__/scripts/codex-agent-loop.test.ts`

**Interfaces:**
- Consumes: `maxIterations`, `maxAutomaticWindows`, `windowNumber`, and `cumulativeIterations`.
- Produces: automatic `window_advanced` events and a terminal `automatic_window_limit` approval pause.

- [ ] **Step 1: Write failing rollover tests**

Configure `maxIterations: 1`, `maxAutomaticWindows: 2`, and scripted fake decisions that return `run`. Assert the controller executes a second Terra iteration without an answer file, records:

```ts
expect(state.windowNumber).toBe(2);
expect(state.cumulativeIterations).toBe(2);
expect(events.some((event) => event.type === "window_advanced")).toBe(true);
```

Script another `run` decision at the second ceiling and assert:

```ts
expect(output.status).toBe("awaiting_user");
expect(output.approvalScope).toEqual(["automatic_window_limit"]);
expect(output.question).toContain("2 automatic windows");
```

Add a regression proving `autoContinuePlan: false` retains the current `iteration_limit` pause after one window.

- [ ] **Step 2: Run focused tests and verify red**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: FAIL because the current loop always pauses at `maxIterations`.

- [ ] **Step 3: Separate window and cumulative counters**

Treat `state.iteration` as the iteration within the current window. Use `cumulativeIterations` for unique evidence-directory numbering so no iteration artifacts are overwritten. At the per-window limit:

```js
if (config.autoContinuePlan && state.windowNumber < config.maxAutomaticWindows) {
  state.windowNumber += 1;
  state.iteration = 0;
  appendEvent(layout, state, "window_advanced", { windowNumber: state.windowNumber });
  saveState(layout, state);
  return continueRun(layout, state, config, executable);
}
```

Implement this iteratively inside the controller loop rather than recursive calls if recursion would grow with window count. Name evidence directories from `cumulativeIterations`.

- [ ] **Step 4: Preserve approval handling across rollover**

At `maxAutomaticWindows`, pause with scope `automatic_window_limit`. Do not add this scope to protected model authority categories; it is a controller safety ceiling. Ensure any executor report or Sol decision requesting a protected approval pauses before rollover.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: PASS.

Commit:

```bash
git add scripts/codex-agent-loop.mjs __tests__/scripts/codex-agent-loop.test.ts
git commit -m "feat(agent-loop): continue across finite windows"
```

### Task 4: Verify end-to-end sequencing, status evidence, and GROW records

**Files:**
- Modify: `scripts/codex-agent-loop.mjs`
- Modify: `__tests__/scripts/codex-agent-loop.test.ts`
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/architecture.md`
- Create or Modify: `.mex/patterns/codex-agent-loop.md`

**Interfaces:**
- Consumes: all plan continuation state and events from Tasks 1–3.
- Produces: public completed status containing `planPath`, `completedTaskIds`, `cumulativeIterations`, `windows`, and `finalCommit` when supplied by the final execution evidence.

- [ ] **Step 1: Write the end-to-end fake-loop test**

Create a two-task Markdown fixture. Script fake Codex responses in this order:

1. Terra completes Task 1.
2. Sol returns `run`, `current_task_id: "2"`, `completed_task_ids: ["1"]`.
3. Terra completes Task 2 with a test commit hash in task-specific report evidence.
4. Sol returns `done`, `current_task_id: null`, `completed_task_ids: ["1", "2"]`.

Assert two executor prompts ran, the second names only Task 2, final status is `completed`, and public output contains all required progress evidence. Add cases where a plan-mentioned protected deployment step still returns `awaiting_user` and where malformed/ambiguous task headings interrupt safely.

- [ ] **Step 2: Run focused test and verify red**

Run: `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`

Expected: FAIL until final status evidence and edge handling are complete.

- [ ] **Step 3: Complete public status and event evidence**

Extend `publicStatus` for running, awaiting, and completed plan-aware runs without exposing prompt or source contents. Include only identifiers, counters, paths, and commit metadata. Emit `plan_task_selected`, `plan_task_completed`, and `plan_completed` events when progress changes; deduplicate events on resume.

- [ ] **Step 4: Update GROW records**

Record the actual controller behavior in `.mex/ROUTER.md`, the development-tool boundary in `.mex/context/architecture.md`, and the repeatable run/resume/approval procedure in `.mex/patterns/codex-agent-loop.md`. Bump each changed scaffold file's `last_updated` to `2026-07-12`. Run `mex log` if available and rationale warrants a decision entry.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npx vitest run __tests__/scripts/codex-agent-loop.test.ts
npm run typecheck
npm run typecheck:test
npm run lint
node -e 'const fs=require("fs"); for (const p of ["config/codex-agent-loop/execution-report.schema.json","config/codex-agent-loop/planner-decision.schema.json"]) JSON.parse(fs.readFileSync(p,"utf8"));'
git diff --check
```

Expected: focused tests, both typechecks, and schema parsing pass; lint has no errors; diff check is clean. Existing lint warnings may remain only if unchanged and must be reported with the exact count.

- [ ] **Step 6: Review scope and commit**

Confirm the diff contains no production runtime, Prisma, API, Shopify/Meta execution, deployment, or strategy-activation change. Confirm no dangerous Codex bypass flag exists:

```bash
! rg -n "dangerously-bypass-approvals-and-sandbox|dangerously-bypass" scripts/codex-agent-loop.mjs config/codex-agent-loop.json
```

Commit:

```bash
git add scripts/codex-agent-loop.mjs config/codex-agent-loop.json config/codex-agent-loop/planner-decision.schema.json __tests__/scripts/codex-agent-loop.test.ts .mex/ROUTER.md .mex/context/architecture.md .mex/patterns/codex-agent-loop.md
git commit -m "feat(agent-loop): continue approved implementation plans"
```
