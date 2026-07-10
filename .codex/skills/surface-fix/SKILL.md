---
name: surface-fix
description: Use when the user invokes surface-fix for a named Agriko product surface.
---

# Surface Fix

Invoke as `$surface-fix "<surface>"`, optionally with `--fix` or `--deploy`.

- Default: audit-only. No worktree, code change, merge, or deployment.
- `--fix`: audit, fix, verify, and merge from an isolated worktree. Do not deploy.
- `--deploy`: implies `--fix`, then deploys and verifies production health.

Reject missing surfaces and unknown flags. Never infer deployment permission without `--deploy` or later explicit authorization.

## Workflow

Read `AGENTS.md`, `.mex/ROUTER.md`, matching `.mex/patterns/`, and the affected code and tests. MEX patterns are the only known-failure authority; apply a declared safe recovery only within its retry bound.

In default audit-only mode, inspect the surface end to end and report the five highest-impact functional issues in severity order. Include evidence, user impact, affected flow, and smallest safe fix. Exclude cosmetic preferences, speculation, and unrelated legacy warnings.

With `--fix`:

1. Create an isolated worktree from current `main`.
2. Audit and fix every accepted surface-owned functional issue using red-green TDD.
3. Run focused tests, relevant full gates, application and test typechecks, lint, production build against disposable local services, and `git diff --check`.
4. Perform one specification review and one code-quality review; resolve their initial findings. A re-review requires explicit user approval.
5. Re-audit. Continue until no P0, P1, or P2 surface-owned issue or introduced warning remains.
6. Update GROW documentation, commit scoped changes, merge directly to `main`, and verify final repository status.

With `--deploy`, complete `--fix` first, then use the established deployment pattern. Confirm the live commit, active build, restarted process, and production health before reporting success.

## Execution contract

No partial handoffs. Give a brief start acknowledgement and concise progress updates during long work, but continue without routine checkpoints. End only with a verified final result or a genuine blocker requiring new authority. Never launch a re-review without permission.

Preserve all `AGENTS.md` invariants. Perform no live Shopify or Meta mutations. Use no production database access or migration for local verification. Never expose credentials. Report unrelated legacy warnings separately rather than looping on them.
