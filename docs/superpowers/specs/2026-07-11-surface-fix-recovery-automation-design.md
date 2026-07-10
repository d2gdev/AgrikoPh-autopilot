# Surface Fix Recovery Automation Design

## Goal

Make the Codex Surface Fix workflow resumable and deterministic for recurring
operational failures without creating a second troubleshooting system beside
MEX patterns.

## Architecture

Create a project runner at `scripts/surface-fix.mjs` and a project-local Codex
skill at `.codex/skills/surface-fix/SKILL.md`. The skill handles audit and code
reasoning; the runner handles worktree lifecycle, persisted state, verification,
merge/deploy eligibility, deployment polling, and recovery orchestration.

`.mex/patterns/` remains the sole source of recovery knowledge. The runner
selects a matching pattern from machine-readable frontmatter, records evidence,
and executes only that pattern's declared safe recovery command. It never
duplicates troubleshooting logic in a script switch statement.

## Invocation

Use `$surface-fix <surface>` for audit-only behavior. Use `--fix` to enable the
isolated remediation lifecycle and `--deploy` to enable deployment only after
the verified merge.

The runner persists each invocation under ignored `.surface-fix/<run-id>.json`.
The record includes mode, surface, worktree, branch, current state, command
results, matched pattern IDs, retries, commits, deployed commit, and health
evidence. Reinvocation resumes an unfinished run instead of creating another
worktree.

## Pattern Contract

Recovery-capable MEX patterns add optional frontmatter:

```yaml
automation:
  signatures: ["prisma-client-not-generated"]
  safe_recovery: "npm run db:generate"
  retry_limit: 1
  requires_approval: false
```

Patterns without this metadata remain human-guided. `requires_approval: true`
means the runner records the match and stops; it must not execute the command.
The deploy pattern defines polling as a recovery procedure, not an immediate
failure: checkout SHA, active `.next/BUILD_ID`, PM2 start time, and public
health must all match the expected release before deployment is successful.

## Failure Handling

The runner classifies command output only into stable signatures declared by
patterns. Examples include a missing Prisma client, no tests collected, stale
worktree state, and remote deployment incomplete. It runs one bounded recovery,
reruns the failed gate, and records both outputs. An unknown failure or exhausted
retry is a failed state with evidence, never a guessed fix.

Legacy lint warnings are baselined by pattern evidence; only warnings introduced
by the changed surface fail the run. A test configuration that finds zero tests
always fails.

## Safety

- Audit mode is non-mutating.
- `--fix` may merge only after recorded gates are green.
- `--deploy` is the only mode allowed to invoke deployment.
- Never auto-run a re-review; explicit approval remains required.
- Never perform Shopify/Meta mutations, production database access, or credential
  disclosure during local recovery.
- Deployment recovery uses the established atomic deployment pattern and does
  not expose process environments or credentials.

## Verification

Test runner state transitions, resume behavior, signature-to-pattern matching,
retry bounds, zero-test rejection, approval-required stopping, and deployment
polling completion/timeout. Test the Codex skill contract and verify that
recovery metadata lives only in MEX patterns.
