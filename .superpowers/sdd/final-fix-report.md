# Agent Loop Final Fix Wave

## RED

- `npm test -- __tests__/scripts/codex-agent-loop.test.ts`: 4 new regressions failed for planner-first startup, immutable plan evidence, and protected runtime impact.

## GREEN

- Protected runtime-impact regression subset: 3/3 passed.
- Implemented private approved-plan snapshot plus SHA-256 binding, planner-first plan startup, complete protected-scope configuration validation, decision-scope restriction, repository fingerprints around executor work, reconciliation-only resume after executor failure, monotonic exclusive answer evidence, append-only event writes, and timeout SIGTERM/SIGKILL escalation.

## Previously open verification concern (resolved)

- The executor-first fixture expectations were converted to the approved planner-first/private-snapshot contract in the continuation below.

## Final continuation

The four obsolete failures were diagnosed and corrected without weakening the contract:

- Two-task fixture now models the initial planner selection of Task 1, then post-executor selection of Task 2, then completion. It asserts both executor prompts, ordered task-selection/completion events, and final commit.
- Initial planner pause correctly asserts zero executor iterations.
- Planner context exposes the normalized approved source identity and immutable task identifiers, but not the private evidence snapshot path.
- Window rollover fixture now models initial selection plus both post-executor planner decisions, preserving exact two-executor/two-window accounting.
- Malformed immutable task headings fail closed before a model turn with process exit 1 and a structured `failed` outcome.

Fresh final evidence:

- `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`: 29 passed, 0 failed.
- `npm run typecheck`: exit 0.
- `npm run typecheck:test`: exit 0.
- `npm run lint`: exit 0, 0 errors, 118 pre-existing warnings; changed controller and controller-test files emitted no warnings.
- JSON parse gate: `config/codex-agent-loop.json`, `execution-report.schema.json`, and `planner-decision.schema.json` all parsed (3/3).
- `git diff --check`: exit 0.
- Exact dangerous-bypass negation over controller/config paths: no matches.

## Second final-review hardening

- Sol now consumes the exact private approved-plan snapshot bytes, its SHA-256 digest, and immutable task identifiers. Public status continues to expose only the normalized original plan identity.
- Resume validates snapshot digest and containment. Regression coverage mutates the original plan after startup and proves subsequent Sol input retains the original task/body; forged digest resume fails closed.
- Executor failure creates durable `executor_failure_reconciliation` evidence with failed task/prompt identity and before/after repository fingerprints. Planner input carries a reconciliation-only contract, and byte-identical failed-prompt replay is deterministically rejected before executor launch.
- Resume validates lifecycle status/phase, counters, ordered progress shape, pending approval invariants, reconciliation shape, and real non-symlink containment of the run/state/inputs/iterations/snapshot evidence roots.
- Plan-aware run decisions now require the exact next task plus TDD/RED-GREEN, verification, commit, GROW, and explicit later/out-of-scope exclusion markers.
- Focused suite expanded to 31 tests: 31 passed, 0 failed.
- `npm run typecheck` and `npm run typecheck:test`: exit 0.
- `npm run lint`: exit 0 with 0 errors and the same 118 unrelated warnings.
- Three JSON config/schema files parsed; `git diff --check` passed; exact dangerous-bypass grep returned no matches.
