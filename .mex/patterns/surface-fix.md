---
name: surface-fix
description: Bounded audit-to-remediation loop for a named product surface.
last_updated: 2026-07-11
---

# Surface Fix

Use `.claude/commands/surface-fix.md` when a user wants a recurring audit/fix loop for one named product surface.

- No flag is audit-only and non-mutating.
- `--fix` permits isolated remediation and direct merge after all local gates pass.
- `--deploy` implies `--fix` and is the only mode that permits the established deployment path.
- A re-review always needs explicit user approval.
- A clean result means no surface-owned P0/P1/P2 defect, required gates pass, and no warning introduced by the surface remains. Record unrelated legacy warnings separately.
