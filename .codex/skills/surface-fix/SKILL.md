---
name: surface-fix
description: Run an evidence-gated, resumable audit/fix/deploy lifecycle for a named Agriko surface. Use when the user invokes $surface-fix.
---

# Surface Fix

Run `node scripts/surface-fix.mjs "<surface>" [--fix|--deploy]` first.

For `--fix` and `--deploy`, do not return routine progress. Continue until the persisted state is terminal. Return only a start acknowledgement, a blocker requiring authority, or the final verified result.

Never claim completion from helper tests. Require the runner state to record every gate. `deployed` requires matching server commit, newer active build, newer PM2 process, and healthy public endpoint.
