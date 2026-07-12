# Agent Loop Plan Continuation Design

## Status

Approved in conversation on 2026-07-12. This document records the design only;
it does not change controller behavior.

## Goal

Allow the Codex agent-loop controller to continue from one completed bounded
task to the next incomplete task in an existing approved implementation plan,
until the plan is complete or a genuine approval boundary or blocker is reached.

The initial run objective must identify the plan file. That plan is the durable
scope boundary. Sol may sequence work already described by that plan, but neither
Sol nor Terra may add new deliverables or infer new authority.

## Required Behavior

After every successful Terra report, Sol must inspect the configured plan and
repository evidence, determine whether the current bounded task is complete, and
select the next incomplete task in plan order. The next Terra prompt must cover
exactly one bounded task or explicitly named subtask, include its required TDD,
verification, commit, and GROW obligations, and restate excluded later work.

Sol returns `done` only when every task in the approved plan is complete, not
merely when the latest bounded task is complete. Completed work is determined
from repository state and verification evidence rather than task checkboxes
alone.

The loop continues automatically across controller iteration windows. Reaching
`maxIterations` creates a continuation checkpoint and starts a fresh window from
the same durable run state without requesting approval. The controller retains a
separate cumulative iteration count and enforces a configurable finite maximum
number of automatic windows to prevent an unbounded malfunction. Exhausting that
ceiling pauses for operator review.

## Safety Boundaries

Automatic continuation does not bypass protected approval scopes. The controller
must still pause before production access, deployment, live Shopify or Meta
writes, production database changes, strategy activation, credential or
permission changes, destructive or irreversible actions, scope expansion, or
material operator judgment.

A task in the plan does not itself grant protected authority. If a later plan
task requires a protected action, Sol must stop at that boundary and request the
specific authority needed. Local implementation, tests, documentation, GROW
records, and local commits remain within the existing development authority.

Invalid model output, repeated execution failure, an ambiguous next task,
conflicting plan/repository state, or a genuine technical blocker must pause or
interrupt truthfully. Automatic continuation must not retry indefinitely or
silently weaken sandboxing.

## State and Configuration

Versioned workflow configuration gains:

- `planPath`: an absolute path or a path resolved beneath the configured working
  directory;
- `autoContinuePlan`: a boolean that enables cross-task continuation;
- `maxAutomaticWindows`: a positive finite safety ceiling.

Run state records the normalized plan path, cumulative iterations, current
window number, current task identifier, and completed task identifiers. These
fields are controller bookkeeping and do not modify the plan document.

On start and resume, the controller validates that the plan remains inside a
readable configured workspace. Each Sol prompt includes the original objective,
plan path, current task, cumulative progress, latest Terra report, protected
approval scopes, and an explicit instruction to select only the next incomplete
plan task.

## Completion and Evidence

The final public result reports the plan path, completed task identifiers,
cumulative iterations and windows, final commit, and the reason Sol determined
the whole plan complete. Existing per-iteration prompts, reports, decisions,
stderr, and event logs remain the evidence trail.

## Testing

Controller tests must prove that it:

1. advances from a completed bounded task to the next plan task;
2. does not finish while an incomplete plan task remains;
3. rolls into a new automatic window at the per-window iteration limit;
4. pauses at the cumulative automatic-window ceiling;
5. pauses for every protected approval scope even when mentioned in the plan;
6. rejects missing, escaping, or unreadable plan paths;
7. resumes deterministically with the recorded current task and progress;
8. preserves current single-objective behavior when `autoContinuePlan` is false.

## Non-Goals

- No concurrent Terra tasks.
- No model-written edits to the implementation plan.
- No automatic deployment, production access, activation, or live writes.
- No generalized project-management system or database-backed queue.
- No removal of finite safety ceilings, structured schemas, sandboxing, or
  operator approval gates.
