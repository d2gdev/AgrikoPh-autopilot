# Final Remediation Report

## Second broad-review remediation

The second review exposed three architecture gaps in the first remediation: approved bytes were mutable, Store Task completion preceded Recommendation finalization, and locks/crash recovery were not durable. These are corrected in behavior before this documentation update:

- approval evidence freezes the strict proposed-state hash; sync skips approved/override/executing linked work and dispatch rejects any mismatch before lock/Shopify;
- the internal dispatcher requires an already claimed `executing` Recommendation and returns only a minimal hash receipt;
- `execute-approved` atomically finalizes Store Task + Recommendation + two audits + receipt + lock release;
- verified or uncertain Shopify outcomes whose local finalization is incomplete remain `reconciliation_needed`, never inconsistently completed/failed;
- locks have owner/acquired/expiry fields with atomic stale takeover, and stale executing recovery reobserves exact after-state before joint completion or failure/release;
- list/detail DTOs are explicit Zod projections with field/count/string/aggregate caps; failed/applying/reconciliation states are visible and retry re-syncs;
- strict source provenance includes bounded references and generation provenance; advisory observation absence is explicit.

Second-round fresh gates: focused 10-file gate 80/80, including real `execute-approved` → governed dispatcher mutation coverage; full `npm test` exit 0; typecheck exit 0; lint exit 0 with 0 errors and 85 pre-existing warnings; diff check clean; exact `autopilot_test` safe build exit 0. No production, deployment, push, or real Shopify/Meta access occurred.

## Result

The broad-review remediation replaces direct route-to-Shopify execution with the existing Recommendation lifecycle. Synchronization creates/links a pending `shopify/apply_topical_map_store_task` Recommendation. Store Pilot confirmation returns `202 queued` after atomically approving that exact Recommendation. Only `execute-approved`, in live mode with an approved/override-approved Recommendation, dispatches the governed Store Task execution service.

## Finding coverage

- Approval architecture: route confirmation performs no Shopify read or write; strict Store Task/Recommendation IDs are linked; unrelated executor branches exclude the allowlisted Shopify action.
- Failure and retry: failed tasks are listable and visible; execution failures reconcile the task and Recommendation; uncertain post-request verification is explicit; retry is re-sync/reobserve and creates fresh pending approval work.
- Observation/body validity: malformed governed URL decoding fails closed, invalid/future Shopify timestamps are rejected, and generated/executed HTML after-state is limited to 50,000 characters.
- Bounded transport/UI: list queries use explicit selects and recursively bounded previews; exact authenticated detail is fetched on demand; approval and execution receipts are minimal.
- Bounded AI: at most 25 candidates, bounded metadata/plain-text excerpts, and a 60,000-character aggregate request limit are enforced with strict response parsing.
- Stable identity/serialization: task dedupe excludes proposed bytes, proposal hash is Recommendation evidence, pending/failed work refreshes without reopening terminal history, and a persisted normalized-target lock prevents concurrent writes before immediate reobservation.
- Provenance/parsing: strategy/rule/resource observation evidence remains strict and bounded; advisory absence stays explicit; malformed percent encoding returns non-governed.

## Verification evidence

- Focused gate: 8 files, 82/82 tests passed.
- Full `npm test`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, 0 errors and 86 warnings before removal of the one new warning; remaining warnings pre-existed.
- `git diff --check`: exit 0.
- Exact safe build using only `autopilot_test` with `connection_limit=10&pool_timeout=10`: exit 0.

## Safety

No production access, deployment, push, real Shopify/Meta mutation, strategy activation, or authorization change occurred.

## Concerns

The local build wrapper exits successfully after launching the Next build and emits truncated terminal output in this harness; its exit status is the recorded gate. No functional concern remains from the reviewed findings.
