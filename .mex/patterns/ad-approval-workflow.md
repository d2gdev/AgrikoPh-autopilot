# Ad Approval Workflow Runbook

The Facebook ad approval feature (Ad Pilot → Ad Approvals). Spec: `docs/ad-approval-spec.md`.
All code lives in the auto-pilot plugin; the storefront theme is never touched (Technical
Review only fetches destination URLs over HTTP).

## Architecture map

- **State machine:** `lib/ad-approval/state-machine.ts` (`transition()` = the single audited,
  version-CAS chokepoint) + `lib/ad-approval/constants.ts` (`STATUS`, `ALLOWED_TRANSITIONS`).
- **AI agents:** `lib/ad-approval/ai-agents/` (Pre/Brand/Technical). Text + HTTP only in v1;
  vision checks emit `SKIPPED`. Worker: `jobs/process-ad-reviews.ts` (cron `process-ad-reviews`).
- **Conflict-of-interest & assignment:** `lib/ad-approval/conflict.ts` (Transition A worker,
  Transition B HTTP, `assignConversionReviewer`).
- **SLA escalation:** `jobs/ad-approval-sla.ts` (cron `ad-approval-sla`).
- **HTTP routes:** `app/api/ad-approvals/**` (submit, conversion-review, penultimate, final,
  revise, cancel, force-transition). Shared helpers: `lib/ad-approval/route-helpers.ts`.
- **Reviewer config:** `app/api/settings/reviewer-assignments/**`, roster `app/api/app-users`,
  UI `app/(embedded)/settings/ReviewerAssignmentsCard.tsx`.
- **Notifications:** `lib/notifications.ts` + `app/api/notifications`.
- **UI:** `app/(embedded)/(ad-pilot)/ad-approvals/{page,[id]/page}.tsx`.

## Common issues

| Symptom | Check |
|---------|-------|
| Ad stuck in `for_*_review` | Is `process-ad-reviews` cron running? Look at `AdAIJobQueue` rows (status/attemptNumber/nextRetryAt/errorMessage) and the `JobRun` for `process-ad-reviews`. |
| Approval flagged `requires_manual_intervention` | Read `flags.reason`. Usually AI retries exhausted, an unassigned role, or an unresolvable conflict. Admin can `force-transition` with justification after fixing. |
| Ad won't advance past Technical Review | Conflict-of-interest (submitter is Penultimate → auto-escalates to Final; submitter is both Penultimate AND Final → 409, admin must reassign). Or a reviewer role is unassigned. |
| Reviewer can't act | The actor's Shopify user id must match the approval's `assigned*ReviewerId`. Reassign in Settings (reassignment does NOT move in-progress approvals). |
| "Cannot unassign role" (400) | By design — roles must always be assigned. Use reassignment. |
| Dropdown empty in Settings | `AppUser` is populated on login; the person must have opened the app at least once. |

## Gotchas

- The migration `20260702000000_add_ad_approval_workflow` was authored offline (no local dev DB).
  Apply with `npm run db:migrate` (see `deploy.md#task-run-database-migrations-in-production`).
- Statuses are plain strings (no Prisma enums), guarded in app code via `transition()`, not DB
  triggers. Every mutation is a version-CAS `updateMany` → treat `count === 0` as a lost race.
- Reviews, revisions, AI reports, and audit rows are immutable by convention (no update/delete
  routes). Don't add mutation endpoints for them.
- Vision-dependent checks are intentionally `SKIPPED` in v1 — that is honest, not a bug.
