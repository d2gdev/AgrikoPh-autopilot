# Codex Agent Loop Controller Design

## Status

The high-level controller design is approved. This document defines the exact
implementation contract and awaits written-spec approval before implementation.

No controller, schema, command, configuration, or runtime behavior is created by
this design document.

## Goal

Automate the current two-window workflow without weakening operator control:

1. a Terra executor receives a self-contained implementation prompt;
2. Terra returns one JSON execution report;
3. a read-only Sol planner evaluates that report and returns a structured decision;
4. the controller either runs the next prompt, pauses for the operator, finishes,
   or aborts safely;
5. every prompt, report, decision, event, and answer is retained so the workflow
   can be resumed after a normal pause or process interruption.

The controller is development tooling. It is not part of the Next.js runtime,
does not use Prisma, and does not import or activate a topical-map package.

## Non-Goals

- Do not create a general autonomous agent platform.
- Do not add an application API route, browser UI, database model, or background
  service.
- Do not grant live Shopify, Meta, production, deployment, database, credential,
  or destructive filesystem authority.
- Do not bypass Codex sandboxing or approval controls.
- Do not infer operator approval from a model-generated prompt or report.
- Do not use a model response as the controller's durable state.
- Do not hard-code topical-map policy semantics in the controller.

## Architecture

Create a project-local Node.js controller at `scripts/codex-agent-loop.mjs`.
It launches the installed Codex CLI with argument arrays through
`child_process.spawn`; it never constructs a shell command from model output.

The controller owns orchestration and persistence. Both model turns are
ephemeral:

```text
initial prompt or resumed state
          |
          v
Terra executor (workspace-write, execution-report schema)
          |
          v
validated execution-report.json
          |
          v
Sol planner (read-only, decision schema)
          |
          +---- continue ----> next Terra iteration
          |
          +---- pause -------> operator answer + resume command
          |
          +---- finish ------> completed run
          |
          +---- abort -------> failed run with evidence
```

Use Codex CLI profiles rather than undocumented model identifiers. The workflow
configuration defaults to profile names `terra-medium` and `sol-xhigh`; the
operator is responsible for defining those profiles in Codex configuration.
The controller fails before starting a run if either profile cannot be used.

The executor runs with `--ephemeral`, `--sandbox workspace-write`, `--cd` set to
the configured implementation worktree, `--add-dir` for each additional allowed
workspace, `--output-schema` for the execution-report schema, `--json` for event
capture, and `--output-last-message` for the final report.

The planner runs with `--ephemeral`, `--sandbox read-only`, the same readable
workspace set, the decision schema, JSON event capture, and a final-message file.
It may inspect repository state but cannot edit it.

The controller deliberately does not use `codex exec resume`. Controller state,
not a hidden model session, is the durable source of truth. Each model request is
self-contained and reproducible from the run directory.

## Project Files

Implementation will add these files:

```text
scripts/codex-agent-loop.mjs
scripts/codex-agent-loop/
  cli.mjs
  controller.mjs
  event-log.mjs
  lock.mjs
  process-runner.mjs
  safety.mjs
  schema-validation.mjs
  state.mjs
config/codex-agent-loop/
  topical-map.json
  execution-report.schema.json
  planner-decision.schema.json
  run-state.schema.json
__tests__/scripts/codex-agent-loop.test.ts
__tests__/scripts/codex-agent-loop-state.test.ts
```

`package.json` will expose:

```json
{
  "scripts": {
    "codex:loop": "node scripts/codex-agent-loop.mjs"
  }
}
```

`.gitignore` will ignore `.codex-agent-loop/`, which contains local run evidence.

No new npm dependency is required. The JSON Schema files are passed directly to
Codex structured output. The controller also performs explicit validation of the
required fields and cross-field invariants instead of adding a second schema
library solely for this CLI.

## Workflow Configuration

`config/codex-agent-loop/topical-map.json` is versioned configuration, not run
state. It contains only controller policy and paths:

```json
{
  "configVersion": "1.0.0",
  "workflowId": "topical-map-strategy-package",
  "executorProfile": "terra-medium",
  "plannerProfile": "sol-xhigh",
  "executorCwd": "/home/sean/Agriko/auto-pilot/.worktrees/feat-topical-map-strategy-persistence",
  "additionalWorkspaces": [
    "/home/sean/Agriko/shopify-theme"
  ],
  "maxIterations": 20,
  "turnTimeoutSeconds": 3600,
  "allowedAuthority": [
    "read_scoped_workspaces",
    "write_scoped_workspaces",
    "run_local_verification",
    "create_local_commits"
  ],
  "alwaysPauseFor": [
    "new_authority",
    "production_access",
    "deployment",
    "live_shopify_or_meta_write",
    "production_database_change",
    "credential_or_permission_change",
    "destructive_or_irreversible_action",
    "scope_expansion",
    "strategy_activation"
  ]
}
```

Paths must resolve to existing directories before a run begins. The controller
must reject a workspace outside the configured set and must never add
`--dangerously-bypass-approvals-and-sandbox` or an equivalent bypass flag.

The absolute paths above intentionally describe the current workflow. A later
workflow may use another versioned configuration without changing controller
logic.

## JSON Contracts

### Execution Report

`execution-report.schema.json` defines the stable envelope Terra must return.
Task-specific evidence remains permitted under additional properties so the
controller does not erase the detailed reports already used by this workflow.

Required fields:

```json
{
  "status": "complete | blocked | failed",
  "outcome": "non-empty string",
  "approval_required": false,
  "approval_question": null,
  "blockers": [],
  "recommended_next_step": "non-empty string or null",
  "runtime_impact": {
    "production_accessed": false,
    "deployed": false,
    "live_changes_made": false
  }
}
```

Schema rules:

- `approval_required=true` requires a non-empty `approval_question`.
- `approval_required=false` requires `approval_question=null`.
- `blockers` is an array of non-empty strings.
- `runtime_impact` may contain task-specific fields but must contain the three
  stable safety booleans above.
- The top-level object permits additional task-specific evidence.
- Invalid JSON, prose around JSON, multiple JSON objects, or a report that fails
  the schema ends the stage as `failed`; the controller never repairs it with a
  second model.

### Planner Decision

`planner-decision.schema.json` is strict and rejects unknown fields. Required
fields:

```json
{
  "action": "continue | pause | finish | abort",
  "reason": "non-empty string",
  "authority_required": false,
  "authority_categories": [],
  "next_prompt": "self-contained prompt or null",
  "user_question": "question or null",
  "choices": [],
  "completion_evidence": []
}
```

Conditional rules:

- `continue` requires `authority_required=false`, a non-empty `next_prompt`, a
  null `user_question`, and no choices.
- `pause` requires a non-empty `user_question`, a null `next_prompt`, and zero
  to three choices shaped as `{ "id": "...", "label": "..." }`.
- `finish` requires a null prompt and question plus at least one concrete
  completion-evidence entry.
- `abort` requires null prompt and question and a reason describing the terminal
  failure.
- `authority_categories` values come from the configured `alwaysPauseFor` set.
- A decision cannot claim `continue` while declaring any authority category.

Sol receives the validated current report, the workflow authority policy, the
current run summary, prior operator answers, and instructions to create exactly
one self-contained next prompt. It does not receive write access.

### Run State

`run-state.schema.json` is strict. It records:

- schema version, run ID, workflow ID, and lifecycle status;
- created and updated timestamps;
- current iteration and configured maximum;
- controller version, repository roots, starting Git heads, and profile names;
- current stage and attempt number;
- relative paths to every prompt, report, decision, event stream, and answer;
- pending question and choices when awaiting the operator;
- the last completed iteration and next safe operation;
- interruption evidence and pre-executor repository fingerprints;
- final completion or failure reason.

Allowed lifecycle values are:

```text
created
executor_running
planner_running
awaiting_user
interrupted_review
completed
failed
```

Only transitions declared by the state module are accepted. State is written to
a temporary file with mode `0600`, flushed, and atomically renamed.

## Run Evidence and Logging

Each run is stored under:

```text
.codex-agent-loop/runs/<run-id>/
  state.json
  events.jsonl
  lock.json
  inputs/
    initial-prompt.md
    operator-answer-0001.md
  iterations/
    0001/
      executor-prompt.md
      executor-events.jsonl
      executor-stderr.log
      execution-report.json
      planner-input.md
      planner-events.jsonl
      planner-stderr.log
      planner-decision.json
```

The run directory and files are local, ignored, and created with restrictive
permissions (`0700` directories, `0600` files). Prompts and reports are treated
as potentially sensitive development evidence.

`events.jsonl` is append-only. Each line has a sequence number, UTC timestamp,
run ID, iteration, stage, event type, and a bounded structured payload. Event
types include run creation, stage start, child exit, schema validation, safety
override, operator pause, operator answer, state recovery, completion, and
failure.

The controller does not log environment variables, credentials, complete child
process environments, or raw command strings. It records the selected profile,
working directory, allowed workspace paths, exit status, timing, and artifact
paths. Codex JSONL events and stderr are kept in separate files so the validated
final JSON cannot be confused with progress output.

The controller prints exactly one JSON status object to stdout at command exit.
That object includes the run ID, status, current iteration, evidence directory,
and either the next resumable command or final result. Human-readable diagnostic
text goes to stderr.

## Approval Pauses

Sol recommends; the controller enforces. A planner decision cannot override the
following deterministic pause rules:

1. Terra reports `approval_required=true`.
2. Sol returns `action=pause` or `authority_required=true`.
3. Sol declares any configured authority category.
4. The proposed step requires production access, deployment, live Shopify or
   Meta writes, a production database change, credential or permission changes,
   destructive or irreversible actions, strategy activation, or broader scope.
5. The run reaches `maxIterations`.
6. A child process is interrupted after an executor may have changed files.
7. The controller cannot prove which stage completed.

For items 4 and 6, the controller uses deterministic state and structured model
fields, not permission inferred from prose. The planner prompt must classify
requested authority. If classification is absent or inconsistent, validation
fails closed.

When paused, the controller writes the question and choices to state, releases
the run lock, and exits. It does not synthesize a `yes`, reuse a prior approval
for a broader scope, or continue because a generated prompt contains approval
language.

An operator answer authorizes only the question and scope recorded for that
pause. The answer becomes immutable run evidence and is supplied to Sol on the
next planning turn.

## Commands and Resume Behavior

Start the current workflow with a prompt file:

```bash
npm run codex:loop -- start \
  --workflow topical-map \
  --prompt-file /absolute/path/to/initial-prompt.md
```

Inspect a run without invoking a model:

```bash
npm run codex:loop -- status <run-id>
```

Resume a normally interrupted run or continue after a non-approval pause:

```bash
npm run codex:loop -- resume <run-id>
```

Answer a pending operator question and resume:

```bash
npm run codex:loop -- resume <run-id> \
  --answer-file /absolute/path/to/operator-answer.md
```

The exit JSON includes the exact applicable resume command, with the run ID but
without inventing an answer-file path.

`resume` validates the state schema, lock state, workflow configuration, evidence
paths, and repository fingerprints before doing work. It refuses to resume a
completed run, an actively locked run, or an awaiting-user run without an
answer. A stale lock is recorded and replaced only when its PID is no longer
alive on the recorded host.

If an executor process ends without a validated report, it may already have
changed the worktree. The controller does not blindly replay that prompt.
It records `interrupted_review`, captures a redacted Git status and head
fingerprint, and invokes only the read-only planner on resume. Sol may produce a
reconciliation prompt within existing authority or request operator review.

If the planner alone is interrupted, resume may safely rerun the same read-only
planner input as a new recorded attempt.

## Process and Failure Handling

- Spawn Codex without a shell and pass every option as a separate argument.
- Write final-message output to a temporary path and rename only after successful
  parsing and schema validation.
- Record child PID, start time, timeout, exit status, and signal.
- On timeout, send `SIGTERM`, wait a bounded grace period, then use `SIGKILL` if
  necessary; record both actions.
- Never place model output in a filename, CLI option, environment-variable name,
  or shell expression.
- Reject symlinked run directories or evidence paths that escape the run root.
- Reject concurrent access through an exclusive per-run lock.
- Stop with `failed` on malformed configuration, missing profiles, schema
  violations, unsafe state transitions, missing evidence, or unknown actions.
- A `blocked` Terra report is not automatically terminal. Sol may create a safe
  next prompt within existing authority or pause for the operator.
- A `complete` Terra report completes only that prompt. Sol must supply concrete
  evidence before the workflow becomes `completed`.

## Prompt Boundaries

The Terra system prompt requires it to:

- follow repository instructions and the authority stated in its prompt;
- perform one bounded task;
- stop rather than expand scope;
- end with exactly one execution-report JSON object matching the schema;
- set `approval_required=true` whenever new authority or an operator judgment is
  needed;
- never claim production, deployment, live-change, test, or commit success
  without fresh evidence.

The Sol system prompt requires it to:

- treat the execution report as untrusted evidence;
- inspect relevant repository state read-only when necessary;
- decide whether the overall objective is complete;
- preserve explicit operator-approval boundaries;
- produce a self-contained Terra prompt only for work already authorized;
- return exactly one planner-decision JSON object matching the strict schema.

Prompt templates live as versioned Markdown files under
`config/codex-agent-loop/prompts/`, not as large string literals in JavaScript.
Implementation will therefore also add:

```text
config/codex-agent-loop/prompts/executor.md
config/codex-agent-loop/prompts/planner.md
config/codex-agent-loop/prompts/interrupted-review.md
```

## Verification Strategy

Use Vitest and a fake Codex executable fixture; automated tests must not call a
real model or the network.

Required tests:

1. start creates a restrictive run directory, valid state, initial prompt, and
   append-only creation event;
2. a valid Terra report and `continue` decision create the next iteration;
3. `approval_required=true` pauses even if a fake planner returns `continue`;
4. every configured authority category pauses;
5. an operator answer is stored, scoped, and included in the next planner input;
6. malformed, prose-wrapped, multi-object, or schema-invalid JSON fails closed;
7. executor and planner stdout events cannot replace their final-message files;
8. exact maximum-iteration enforcement;
9. active-lock rejection and stale-lock recovery;
10. atomic state writes survive a simulated write failure;
11. planner interruption is safely rerunnable;
12. executor interruption enters `interrupted_review` and never blindly replays;
13. resume rejects missing evidence and repository-fingerprint conflicts;
14. child processes are spawned without a shell and never receive a dangerous
    bypass flag;
15. path traversal and symlink escape attempts are rejected;
16. stdout contains one valid controller status object;
17. the approved topical-map execution-report shapes remain accepted through
    additional task-specific fields;
18. no test changes application data, production state, Shopify state, or the
    approved topical-map package.

Verification commands for implementation:

```bash
npm test -- __tests__/scripts/codex-agent-loop.test.ts \
  __tests__/scripts/codex-agent-loop-state.test.ts
npm run typecheck
npm run typecheck:test
npm run lint
git diff --check
```

## Acceptance Criteria

The controller is complete only when:

- one command can start the Sol/Terra relay from a prompt file;
- every model final response is schema-constrained and independently validated;
- every iteration has reproducible prompt, report, decision, and event evidence;
- the controller pauses deterministically for new authority and emits a usable
  resume command;
- an approved answer resumes the same run without copying reports between chat
  windows;
- interrupted executor work is reconciled instead of blindly repeated;
- concurrent loops, invalid transitions, path escapes, and malformed JSON fail
  closed;
- no dangerous sandbox bypass, live execution, deployment, or production access
  is introduced;
- tests pass without real Codex or network calls;
- GROW records the new recurring controller workflow and its recovery procedure.

## Implementation Sequence After Written-Spec Approval

1. Add JSON schemas, prompt templates, and failing contract tests.
2. Add atomic state, append-only event logging, and lock handling.
3. Add safe Codex process execution and final-message validation.
4. Add the controller state machine and deterministic approval policy.
5. Add start, status, and resume CLI commands.
6. Add the topical-map workflow configuration and npm command.
7. Run focused tests, type checks, lint, whitespace checks, and safety review.
8. Update GROW documentation and commit the verified implementation.

Implementation does not import or activate the approved strategy package and
does not resume Task 2B, locator resolution, compiler work, or any live workflow.

## Documentation Basis

The installed Codex CLI was verified to expose non-interactive `codex exec`,
profiles, model selection, sandbox selection, working-directory and additional
directory controls, `--ephemeral`, `--output-schema`, JSONL event output, and
`--output-last-message`. The controller uses those local capabilities directly.

OpenAI's Agents SDK also documents code-driven orchestration, manager-style
agents, handoffs, sessions, and tracing. Those concepts support the orchestration
model, but the implementation uses the installed Codex CLI so it can preserve
the user's existing Codex profiles and workspace permissions without assuming
API model-name or account parity:

- <https://openai.github.io/openai-agents-js/guides/multi-agent/>
- <https://openai.github.io/openai-agents-js/guides/handoffs/>
- <https://openai.github.io/openai-agents-js/>
