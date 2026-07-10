# Surface Fix Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-local `/surface-fix <surface>` command whose default is a non-mutating audit and whose explicit flags govern remediation and deployment.

**Architecture:** Store the slash-command instructions in `.claude/commands/surface-fix.md`, matching the repository's existing command convention. Lock its safety-critical text contract with a filesystem-based Vitest regression so a future edit cannot accidentally make audit mode mutate, deploy implicitly, or bypass the user's re-review rule. Record the reusable workflow in `.mex/patterns/` and route it from the project index.

**Tech Stack:** Markdown project command, Vitest 4, Node filesystem API, Git, existing `.mex` documentation.

## Global Constraints

- `/surface-fix <surface>` must be audit-only by default: no worktree, code, merge, or deployment change.
- `--fix` may create an isolated worktree and branch, remediate, verify, and merge directly to `main` only after local gates pass.
- `--deploy` implies `--fix`; it alone permits deployment and production-health verification.
- A re-review always requires explicit user approval.
- Do not execute live Shopify or Meta mutations, access or migrate production databases during local verification, expose credentials, or narrow features merely to make an audit clean.
- Stop only when no P0/P1/P2 surface-owned functional issues remain, gates pass, and no surface-owned warning remains; report unrelated legacy warnings separately.
- Follow red-green TDD and preserve unrelated worktree changes.

---

### Task 1: Lock the command safety contract with a failing regression test

**Files:**
- Create: `__tests__/commands/surface-fix-command.test.ts`

**Interfaces:**
- Consumes: UTF-8 Markdown at `.claude/commands/surface-fix.md`.
- Produces: a regression suite that fails until the command explicitly describes the default, `--fix`, `--deploy`, re-review, termination, and safety behavior.

- [ ] **Step 1: Write the failing test**

Create `__tests__/commands/surface-fix-command.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const commandPath = resolve(process.cwd(), ".claude/commands/surface-fix.md");

function readCommand() {
  return readFileSync(commandPath, "utf8");
}

describe("surface-fix command", () => {
  it("keeps the default invocation audit-only and non-mutating", () => {
    const command = readCommand();

    expect(command).toContain("/surface-fix <surface>");
    expect(command).toMatch(/default[\s\S]{0,180}audit-only/i);
    expect(command).toMatch(/no worktree, code change, merge, or deployment/i);
  });

  it("requires explicit flags for remediation and deployment", () => {
    const command = readCommand();

    expect(command).toMatch(/--fix[\s\S]{0,240}isolated worktree/i);
    expect(command).toMatch(/--deploy[\s\S]{0,120}implies[\s\S]{0,80}--fix/i);
    expect(command).toMatch(/--deploy[\s\S]{0,240}production health/i);
  });

  it("preserves review approval, safety boundaries, and finite stopping criteria", () => {
    const command = readCommand();

    expect(command).toMatch(/re-review[\s\S]{0,100}explicit user approval/i);
    expect(command).toMatch(/no live Shopify or Meta mutations/i);
    expect(command).toMatch(/no production database access or migration/i);
    expect(command).toMatch(/no P0, P1, or P2[\s\S]{0,180}surface-owned/i);
    expect(command).toMatch(/unrelated legacy warnings[\s\S]{0,120}separately/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- __tests__/commands/surface-fix-command.test.ts`

Expected: FAIL because `.claude/commands/surface-fix.md` does not yet exist.

- [ ] **Step 3: Commit the red test**

```bash
git add __tests__/commands/surface-fix-command.test.ts
git commit -m "test: define surface fix command contract"
```

### Task 2: Implement the project-local `/surface-fix` command

**Files:**
- Create: `.claude/commands/surface-fix.md`

**Interfaces:**
- Consumes: a required `<surface>` argument and optional `--fix` or `--deploy` flag.
- Produces: deterministic agent instructions for an audit-only default, remediation mode, deployment mode, review rules, validation gates, stopping criteria, and report.

- [ ] **Step 1: Create the minimal command implementation**

Create `.claude/commands/surface-fix.md` with:

```markdown
---
name: surface-fix
description: Audit a named product surface, or explicitly remediate and deploy it through a bounded quality loop.
---

# Surface Fix

Interpret the first non-flag argument as `<surface>`. Accept only these modes:

- `/surface-fix <surface>` — default audit-only mode.
- `/surface-fix <surface> --fix` — audit, remediate, verify, and merge mode.
- `/surface-fix <surface> --deploy` — audit, remediate, verify, merge, deploy, and health-check mode. `--deploy` implies `--fix`.

Reject an invocation without `<surface>`. Reject unknown flags. Do not treat `--deploy` as implied by any wording other than the explicit flag or a later explicit user authorization.

## Required preparation

Read `AGENTS.md`, `.mex/ROUTER.md`, the routed context and matching pattern files, relevant recent commits, and every source/test file reached by the named surface before reporting an issue or changing code. Preserve the project invariants for auth, permissions, Prisma, guardrails, job locks, approval, publishing, and credentials.

## Audit-only default

Default behavior is audit-only. Do not create a worktree, code change, commit, merge, or deployment. Inspect the named surface end-to-end and report the five highest-impact functional issues in severity order. For each issue, include evidence, affected files or flows, user impact, severity, and the smallest safe remediation. Do not list cosmetic preferences, speculative improvements, or unrelated legacy warnings as functional blockers.

## `--fix` behavior

Create an isolated worktree and branch from current `main`. Repeat this loop without routine user checkpoints:

1. Audit the named surface and rank the five highest-impact surface-owned functional defects.
2. Fix all accepted defects using strict red-green TDD and focused regression tests.
3. Run focused tests, the full suite when feasible, application and test typechecks, lint, production build against disposable local services, security checks relevant to the change, and `git diff --check`.
4. Run one specification review and one code-quality review. Resolve their initial findings and rerun affected verification.
5. Never launch a re-review without explicit user approval.
6. Re-audit the same surface.

Stop only when no P0, P1, or P2 surface-owned functional issue remains, all required verification passes, and no error or warning introduced by the changed surface remains. Report unrelated legacy warnings separately; do not loop on them. Do not rebuild, disable, remove, defer, or silently narrow an affected feature merely to satisfy the stopping condition.

After the loop passes, update GROW documentation and relevant runbooks, commit clearly scoped changes, verify the worktree contains only surface-fix changes, and merge directly to `main`. Do not deploy in `--fix` mode.

## `--deploy` behavior

Perform all `--fix` behavior first. Only after the merge and every local gate passes, use the established deployment pattern, verify the production health endpoint, and report the deployed commit and health result. Do not perform live Shopify or Meta mutations, production database access or migration during local verification, SSH actions unrelated to the approved deployment, or credential exposure.

## Final report

State the mode, audited scope, ranked findings, changed files and commits when applicable, exact verification commands and pass/fail totals, reviews performed and findings resolved, excluded legacy items, merge/deployment status, and any remaining risks. Do not claim that the surface is clean based on partial test output.
```

- [ ] **Step 2: Run the command contract test to verify it passes**

Run: `npm test -- __tests__/commands/surface-fix-command.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 3: Commit the command implementation**

```bash
git add .claude/commands/surface-fix.md
git commit -m "feat: add surface fix command"
```

### Task 3: Document the recurring workflow and run final local verification

**Files:**
- Create: `.mex/patterns/surface-fix.md`
- Modify: `.mex/patterns/INDEX.md`
- Modify: `.mex/ROUTER.md`

**Interfaces:**
- Consumes: `.claude/commands/surface-fix.md` and its contract test.
- Produces: project navigation that tells future sessions when and how to use the command safely.

- [ ] **Step 1: Create the reusable project pattern**

Create `.mex/patterns/surface-fix.md` with:

```markdown
---
name: surface-fix
description: Bounded audit-to-remediation loop for a named product surface.
last_updated: 2026-07-11
---

# Surface Fix

Use `.claude/commands/surface-fix.md` when a user wants a recurring audit/fix loop for one named product surface.

- No flag is audit-only and non-mutating.
- `--fix` permits isolated remediation and direct merge after all local gates pass.
- `--deploy` implies `--fix` and is the only mode that permits the established deployment path.
- A re-review always needs explicit user approval.
- A clean result means no surface-owned P0/P1/P2 defect, required gates pass, and no warning introduced by the surface remains. Record unrelated legacy warnings separately.
```

- [ ] **Step 2: Add the index route and current-state record**

Add this table row to `.mex/patterns/INDEX.md`:

```markdown
| [surface-fix.md](surface-fix.md) | Running a bounded audit/fix loop for one named product surface |
```

Add this bullet under the current project state in `.mex/ROUTER.md` and update its `last_updated` value to `2026-07-11`:

```markdown
- **Project-local `/surface-fix` command (2026-07-11):** `.claude/commands/surface-fix.md` defaults to a non-mutating audit of a named surface. `--fix` enables isolated audit/remediation/verification/direct-merge looping, while `--deploy` implies `--fix` and is required before deployment. It stops only when surface-owned P0–P2 defects and introduced warnings are clear; re-reviews require explicit user approval and unrelated legacy warnings are reported separately.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
npm test -- __tests__/commands/surface-fix-command.test.ts
npm run typecheck:test
npm run lint
git diff --check
```

Expected: command test passes with 3 tests; test typecheck passes; lint has zero errors; diff check has no output. Record existing unrelated warnings without treating them as a command failure.

- [ ] **Step 4: Commit documentation and verification changes**

```bash
git add .mex/patterns/surface-fix.md .mex/patterns/INDEX.md .mex/ROUTER.md
git commit -m "docs: document surface fix workflow"
```

## Plan Self-Review

- Spec coverage: Task 1 protects the command contract; Task 2 implements all three modes, safety boundaries, review restriction, finite stopping rule, and report; Task 3 makes the workflow discoverable and verifies it.
- Placeholder scan: no incomplete markers, deferred steps, or undefined interfaces remain.
- Type consistency: the command path, the three flags, and the contract-test expectations are identical in every task.
