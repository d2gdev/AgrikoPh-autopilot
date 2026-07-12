# Agent Loop Final Fix Wave

## RED

- `npm test -- __tests__/scripts/codex-agent-loop.test.ts`: 4 new regressions failed for planner-first startup, immutable plan evidence, and protected runtime impact.

## GREEN

- Protected runtime-impact regression subset: 3/3 passed.
- Implemented private approved-plan snapshot plus SHA-256 binding, planner-first plan startup, complete protected-scope configuration validation, decision-scope restriction, repository fingerprints around executor work, reconciliation-only resume after executor failure, monotonic exclusive answer evidence, append-only event writes, and timeout SIGTERM/SIGKILL escalation.

## Remaining verification concern

- The full focused suite still has legacy expectations coupled to executor-first plan startup and original-plan-path prompt disclosure. Those tests require conversion to the approved planner-first/private-snapshot contract. This wave is therefore not represented as fully green.
