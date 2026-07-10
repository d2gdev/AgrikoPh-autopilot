# Surface Fix Command Design

## Goal

Provide a reusable `/surface-fix <surface>` command that turns a named product
surface into a controlled audit-to-remediation loop. It must make progress
without needless checkpoints while preserving existing approval, review, and
production-safety boundaries.

## Command Contract

`/surface-fix <surface>` is audit-only by default. It discovers the surface,
inspects the relevant UI, routes, jobs, tests, and recent changes, and reports
the five highest-impact issues in severity order. It makes no worktree, code,
merge, or deployment change.

`/surface-fix <surface> --fix` performs the audit, creates an isolated
worktree/branch from current `main`, fixes the discovered issues using strict
red-green TDD, runs the required local gates, and merges directly to `main`
only after all gates pass.

`/surface-fix <surface> --deploy` implies `--fix`, then uses the established
deployment pattern and verifies the production health endpoint. Deployment is
never part of the default invocation.

## Remediation Loop

For `--fix` and `--deploy`, repeat the following loop:

1. Audit and rank the top five surface-owned functional defects.
2. Implement all accepted findings with focused regression coverage.
3. Run focused tests, full test suite, app/test typechecks, lint, production
   build against disposable local services, and `git diff --check` as relevant
   to the surface.
4. Run one specification review and one code-quality review.
5. Resolve initial review findings and re-run the affected verification.
6. Re-audit the surface.

The loop stops when no P0, P1, or P2 functional defect remains; all required
gates pass; and no error or warning introduced by the changed surface remains.
It does not expand into unrelated legacy warnings, pre-existing global lint
warnings, stylistic preferences, or speculative P3 improvements. Those are
reported separately with evidence.

## Approval and Safety

- Do not start a re-review without explicit user approval.
- Do not execute live Shopify or Meta mutations as part of audit or local
  verification.
- Do not access or migrate a production database during local work.
- Do not deploy unless `--deploy` was supplied or the user explicitly authorizes
  deployment.
- Preserve project auth, permission, guardrail, concurrency, job-lock, and
  approval/publishing invariants.
- Do not silently narrow a feature merely to make an audit clean.

## Reporting

Each invocation reports the audited scope, ranked findings, evidence, commands
and totals, changed files/commits when applicable, unresolved excluded items,
and final branch/deployment status. A `--fix` run proposes the next loop
automatically instead of waiting at routine checkpoints.

## Testing

Validate the skill as a command contract: default invocation is non-mutating;
`--fix` selects the remediation workflow without deployment; `--deploy`
selects remediation plus the project deployment pattern; and termination
criteria exclude unrelated legacy warnings while rejecting surface-owned
failures.
