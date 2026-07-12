# Topical-map production activation design

## Objective

Make the already validated six-artifact topical-map package govern Content Pilot and SEO proposal evaluation in production. Preserve the original development safeguard: activation is disabled by default and cannot occur accidentally in development or tests.

## Authorization model

- Add a server-only `TOPICAL_MAP_ACTIVATION_ENABLED` flag that defaults to `false` when absent.
- Activation is permitted only when the flag is exactly `true`, the persisted package is valid and in the `validated` lifecycle, and an authenticated `SETTINGS_ADMIN` operator explicitly calls the existing activation route.
- Package import and validation remain unable to activate as a side effect.
- `EXECUTE_APPROVED_LIVE_ENABLED` remains `false`; topical-map activation does not authorize publishing, Shopify writes, Meta writes, redirects, canonical changes, or indexation changes.
- The reviewed contract distinguishes strategy-selection authority from live-execution authority. The production activation revision permits the former while keeping `liveExecutionAuthorized: false` and `canonicalIndexationExecutionProhibited: true`.

## Package revision

Create a new reviewed compilation-contract revision and manifest identity rather than modifying the imported immutable package in place. Preserve all five semantic Markdown/CSV artifacts byte-for-byte. Change only the contract approval fields necessary to make the package activation-eligible, update its review record, contract hash, manifest contract entry, and package hash, then import and validate the new six-artifact identity.

## Runtime behavior

The activation service reads the server-side flag before opening its transaction. With the flag disabled, it returns the existing lifecycle conflict and performs no database work. With the flag enabled, it retains the existing serializable, site-scoped transaction, validated-package checks, pointer ownership, lifecycle transitions, and audit record. Proposal integration continues to load only the active, valid, complete six-artifact projection.

## Deployment and activation sequence

1. Implement and test the flag and revised contract grammar.
2. Produce and review the activation-authorized contract revision and new manifest/package hash.
3. Run the full local and PostgreSQL acceptance matrix.
4. Deploy code and expand-only metadata changes with live execution still disabled.
5. Install and import the revised package in production; require zero validation issues.
6. Set `TOPICAL_MAP_ACTIVATION_ENABLED=true`, restart PM2 without inherited overrides, and call the authenticated activation route once.
7. Verify the active pointer, lifecycle, audit provenance, proposal-governance lookup, PM2 state, and public health.

## Failure and rollback behavior

- Any contract, hash, freshness, eligibility, permission, or lifecycle failure prevents activation without changing the active pointer.
- If activation succeeds but governance behavior is later rejected, use the audited strategy rollback only when a previously validated historical active version exists. Do not roll back the expand-only Prisma schema.
- Turning `TOPICAL_MAP_ACTIVATION_ENABLED=false` prevents future activation requests but does not silently change an existing pointer; pointer changes remain explicit and audited.

## Acceptance criteria

- Default/disabled environments cannot activate.
- Production activation requires the exact flag, valid revised package, and `SETTINGS_ADMIN` request.
- The new package becomes the sole active `agrikoph.com` pointer and proposal evaluation loads its 1,493 compiled rules.
- Live execution remains disabled and no Shopify/Meta write occurs.
- Full tests, typechecks, lint, build, guarded PostgreSQL integration, production migration status, PM2, and public health pass.
