---
name: backlog
description: Persisting general deferred work and future checks with a required due date.
triggers:
  - "wait"
  - "do this later"
  - "check later"
  - "add to backlog"
last_updated: 2026-07-20T12:16:25+08:00
---

# General Backlog

## Boundary

Use Backlog for general work that is intentionally deferred or needs a future
recheck. Do not duplicate existing SEO Tasks, Store Tasks, Recommendations, or
other specialized work records.

## Steps

1. Before handing off deferred work, choose an explicit due date with the
   operator or use an already agreed date.
2. Create the item through the authenticated `POST /api/backlog` boundary with
   a concise title, enough context to perform the check, and the required
   `dueAt`.
3. Read the created item back and confirm its persisted due date and open
   status. The assistant uses the private API key; the embedded UI uses the
   Shopify session. Both paths reach the same service and audit log.
4. On the due date, verify the real external or internal state before marking
   the item complete. If it still needs waiting, edit the due date and retain
   the item as open.

## Rules

- A prose promise to revisit work is not a backlog record.
- Never complete an item merely because its due date arrived.
- Deleting an item requires an explicit operator or UI action and retains an
  audit receipt.
- Backlog does not broaden authority for the deferred task. Any later external
  mutation still requires its normal approval and guardrails.

## Verify

- [ ] The item has a non-empty title and description.
- [ ] The due date is explicit and displayed in Asia/Manila.
- [ ] API, authenticated UI, `BacklogItem`, and `AuditLog` agree.
- [ ] Specialized SEO or Store work was not duplicated.
