---
name: lean-planning
description: Use when planning implementation work in an Agriko project, especially before a task with multiple meaningful steps, deployment risk, or uncertain scope.
---

# Lean Planning

## Principle

Use the smallest planning artifact that makes the work safe and verifiable. Planning must reduce uncertainty, not restate the implementation.

## Quick Gate

Answer silently in a few seconds:

1. Will work span multiple sessions or agents?
2. Does it cross multiple independent subsystems?
3. Is rollback difficult or failure materially risky?
4. Does another implementer need a standalone zero-context handoff?

Use a comprehensive plan when two or more answers are yes. Otherwise use lean planning. Follow an explicit user request for either format.

## Planning Levels

| Situation | Output |
|---|---|
| Obvious diagnostic or one-file edit | No formal plan |
| Routine or moderate multi-step work | 3–7 outcome-oriented steps in the active working plan |
| Two or more gate answers are yes | Use `superpowers:writing-plans` |

## Lean Plan Contract

Include only:

- discovery or reproduction;
- the implementation boundary;
- proportional tests and verification;
- deployment or handoff when requested.

Keep one step in progress at a time. Update the plan when evidence changes the approach.

Do not create a plan document, design document, plan commit, prewritten implementation code, artificial 2–5 minute steps, or subagent handoff merely because a task has several steps.

Planning depth never weakens TDD, approval, audit, stale-state, rollback, production-health, or verification safeguards.

## Common Mistakes

- Counting files instead of independent subsystems.
- Treating production deployment alone as requiring a comprehensive plan.
- Skipping a plan when sequencing or verification is genuinely unclear.
- Turning the lean plan into a hidden comprehensive plan.
