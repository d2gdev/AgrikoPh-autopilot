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

Default behavior is audit-only. There is no worktree, code change, merge, or deployment. Do not create a commit. Inspect the named surface end-to-end and report the five highest-impact functional issues in severity order. For each issue, include evidence, affected files or flows, user impact, severity, and the smallest safe remediation. Do not list cosmetic preferences, speculative improvements, or unrelated legacy warnings as functional blockers.

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

Perform all `--fix` behavior first. Only after the merge and every local gate passes, use the established deployment pattern, verify the production health endpoint, and report the deployed commit and health result. No live Shopify or Meta mutations. No production database access or migration during local verification. Do not perform SSH actions unrelated to the approved deployment or expose credentials.

## Final report

State the mode, audited scope, ranked findings, changed files and commits when applicable, exact verification commands and pass/fail totals, reviews performed and findings resolved, excluded legacy items, merge/deployment status, and any remaining risks. Do not claim that the surface is clean based on partial test output.
