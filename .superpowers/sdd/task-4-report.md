# Task 4 implementation report

## Status

Implemented end-to-end approved-plan sequencing, sanitized public progress evidence, transition-deduplicated plan events, malformed-plan interruption, and GROW records from base `67d4e778a27deae8a1a8e9d9d8cd1dda02a6440e`.

## TDD evidence

Initial focused run after adding the end-to-end and plan-heading tests:

```text
Test Files  1 failed (1)
Tests  3 failed | 17 passed (20)
```

The expected failures showed that completed status omitted plan evidence, malformed headings could finish an empty plan, and duplicate headings were not diagnosed as ambiguous. A second red cycle added the mandated dangerous-bypass source assertion; it failed 1/21 because the defensive check itself contained the forbidden token literally.

Final focused run:

```text
Test Files  1 passed (1)
Tests  21 passed (21)
Duration  2.84s
```

## Behavior and files

- `scripts/codex-agent-loop.mjs`
  - Rejects empty, malformed, or duplicate `### Task <id>: <title>` plan headings.
  - Adds plan path, current/completed task identifiers, cumulative iterations, and windows to plan-aware public status without exposing objectives, prompts, plan source, reports, or answers.
  - Publishes `finalCommit` only for a hex commit identifier supplied as final task-specific `evidence.commit`.
  - Emits `plan_task_selected` and `plan_task_completed` only from persisted progress deltas, which prevents unchanged planner progress from duplicating events on resume.
  - Emits `plan_completed` only at the terminal plan transition.
  - Retains the defensive bypass-argument check without embedding the forbidden CLI token in source.
- `config/codex-agent-loop/execution-report.schema.json`
  - Permits task-specific top-level evidence, matching the controller validator and design contract while retaining the required safety envelope.
- `__tests__/scripts/codex-agent-loop.test.ts`
  - Scripts two executor reports and two planner decisions through a two-task completion.
  - Verifies the second executor receives only Task 2, final public evidence, ordered progress events, protected deployment pause, malformed/duplicate heading interruption, and absence of dangerous bypass flags.
- `.mex/ROUTER.md`, `.mex/context/architecture.md`, `.mex/patterns/codex-agent-loop.md`, and `.mex/patterns/INDEX.md`
  - Record current behavior, the development-only authority boundary, and the repeatable start/status/resume/approval procedure with `last_updated: 2026-07-12` on changed scaffold files.
- `.mex/events/decisions.jsonl`
  - Records why automatic continuation remains bounded local-development authority.

## Complete verification

- `npx vitest run __tests__/scripts/codex-agent-loop.test.ts`: PASS, 1 file and 21/21 tests.
- `npm run typecheck`: PASS (`tsc --noEmit`, exit 0).
- `npm run typecheck:test`: PASS (`tsc --noEmit -p tsconfig.test.json`, exit 0).
- `npm run lint`: 0 errors and 118 existing warnings; ESLint exits 1 because warnings are present. None are in Task 4 files.
- Schema JSON parse command: PASS, exit 0.
- `git diff --check`: PASS, exit 0.
- Exact dangerous-bypass grep negation: PASS, exit 0.

## Scope and self-review

- No production runtime, Prisma, API, Shopify/Meta execution, deployment, database, credential, or strategy-activation code changed.
- Executor remains `workspace-write`; planner remains `read-only`; finite iteration/window ceilings remain enforced.
- Protected approval decisions are still processed before any next executor prompt or window rollover.
- Public status reads only bounded controller state and a syntactically validated commit identifier. Raw task-specific evidence remains private in the run directory.
- Existing unrelated modifications to Task 1–3 reports were not staged.

## Concerns

The repository-wide lint command currently exits 1 solely due to 118 pre-existing warnings despite reporting 0 errors. Task 4 introduces no lint finding.

## Review fixes

Two review findings were corrected with a separate RED/GREEN cycle:

- Restored `additionalProperties: false` at the execution-report root and added one optional bounded `evidence` object. It requires exactly `commit`, rejects other evidence fields, and validates the commit as 7–64 hexadecimal characters. Runtime validation now enforces the same contract.
- Tightened plan heading parsing so `### Task 1:` and titles containing only spaces/tabs interrupt as invalid plan task headings instead of entering planner completion validation.

### Review-fix RED

Command:

```bash
npx vitest run __tests__/scripts/codex-agent-loop.test.ts
```

Exact result:

```text
Test Files  1 failed (1)
Tests  3 failed | 21 passed (24)
```

The failures were the open root schema assertion, empty-title interruption, and whitespace-only-title interruption.

### Review-fix GREEN

The same focused command then returned:

```text
Test Files  1 passed (1)
Tests  24 passed (24)
Duration  3.25s
```

Both schema JSON files were parsed with:

```bash
node -e 'const fs=require("fs"); for (const p of ["config/codex-agent-loop/execution-report.schema.json","config/codex-agent-loop/planner-decision.schema.json"]) JSON.parse(fs.readFileSync(p,"utf8"));'
```

Result: exit 0, no output.

`git diff --check` result: exit 0, no output.
