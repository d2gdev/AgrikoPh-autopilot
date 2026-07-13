# Task 4 report: Store Pilot operator workflow

## Outcome

- Added map-specific task details with executable/advisory capability, strategy and package identity, rules, observation time, governed target, advisory reason, and explicit before/after fields.
- Added an accessible Polaris confirmation modal that receives the selected task and delegates confirmation without constructing proposed state.
- Added topical-map synchronization, confirmed apply, separate busy states, persistent API error feedback, success toasts, and full task-bucket reloads.
- Preserved ordinary Store Task Complete/Dismiss controls; executable map tasks use Apply/Dismiss and advisory tasks use Dismiss only.
- No production, real Shopify, deployment, database, or live execution boundary was accessed.

## TDD evidence

- Red: the prescribed focused suite failed with the two missing component modules and absent sync/apply/page feedback behavior.
- Green: `npx vitest run __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts` passed 7/7.

## Verification

- `npm run typecheck -- --pretty false` passed.
- Targeted ESLint for the five Task 4 source/test files passed.
- `git diff --check` passed.

## Review notes

- Server error messages from 403, 409, and 502 apply responses are retained in the persistent Banner.
- Duplicate sync/apply/update actions are disabled while a mutation is active.
- DataTable remains the established responsive queue surface; details use wrapping Polaris stacks and minimum-width before/after columns.

## Review follow-up

- Replaced source-regex workflow coverage with jsdom interaction tests using Testing Library and user-event. The file-level environment annotation leaves the broader Node test suite unchanged.
- Added one synchronous shared mutation guard across Sync, Apply confirmation, Complete, and Dismiss. All mutating controls, including an already-open modal confirmation, disable while any mutation is active; same-tick repeat handler calls return without a second request.
- Removed the duplicate topical-map target, labelled strategy version and package identity explicitly, and retained ordinary task target rendering.
- Long current and proposed values now render a 400-character preview initially. Standard Polaris disclosure buttons expose each exact full value on demand in both the queue and confirmation modal.
- Added compatible UI test infrastructure as dev-only dependencies: `@testing-library/react`, `@testing-library/user-event`, and `jsdom`.

### Follow-up TDD and verification

- RED: the interaction suite failed on missing global mutation disabling, unlabelled identity, duplicate target output, and unbounded 50,000-character values. A separate regression failed because an already-open modal confirmation remained enabled during Sync.
- GREEN: `npx vitest run __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts` passed 11/11.
- `npm run typecheck -- --pretty false`, targeted ESLint, and `git diff --check` passed.
