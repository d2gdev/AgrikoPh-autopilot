# Topical-map Production Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the reviewed topical-map package as the authoritative production proposal-governance strategy without authorizing Shopify, Meta, publishing, redirect, canonical, or indexation execution.

**Architecture:** Replace the permanent activation rejection with a default-false server flag while preserving the existing authenticated route and serializable activation transaction. Publish a new immutable contract/manifest identity that explicitly authorizes strategy selection but not live execution, validate it locally, deploy, import, activate once, and verify the active pointer and governance lookup.

**Tech Stack:** Next.js 15, TypeScript, Zod, Prisma 6, PostgreSQL 16, Vitest, PM2.

## Global Constraints

- `TOPICAL_MAP_ACTIVATION_ENABLED` is server-only and defaults to disabled.
- `EXECUTE_APPROVED_LIVE_ENABLED=false` throughout implementation and rollout.
- Preserve the five semantic Markdown/CSV artifacts byte-for-byte.
- Never mutate the already imported immutable package; create a new contract revision, manifest hash, and package hash.
- Import never activates. Activation requires `SETTINGS_ADMIN`, a valid `validated` package, the production flag, and an explicit request.
- No Shopify/Meta write, publishing, redirect, canonical, or indexation execution is authorized.

---

### Task 1: Runtime production activation gate

**Files:**
- Modify: `lib/topical-map/activation.ts`
- Modify: `.env.example`
- Test: `__tests__/lib/topical-map/activation.test.ts`
- Test: `__tests__/api/topical-map-routes.test.ts`

**Interfaces:**
- Consumes: `process.env.TOPICAL_MAP_ACTIVATION_ENABLED`
- Produces: `runtimeActivationEnabled(): boolean`, true only for the exact value `"true"`; `activateStrategyVersion` retains its current signature and transaction.

- [ ] **Step 1: Write failing tests** proving absent, empty, `false`, and non-exact values reject before database access, while exact `true` reaches the existing validated lifecycle transaction; route auth and permission checks remain first.
- [ ] **Step 2: Run RED** with `npm test -- __tests__/lib/topical-map/activation.test.ts __tests__/api/topical-map-routes.test.ts`; expect the enabled-path test to fail because activation always rejects.
- [ ] **Step 3: Implement the minimum gate**:

```ts
export function runtimeActivationEnabled(): boolean {
  return process.env.TOPICAL_MAP_ACTIVATION_ENABLED === "true";
}

if (!runtimeActivationEnabled()) {
  throw new StrategyActivationConflictError("Runtime topical-map activation is not authorized.");
}
```

- [ ] **Step 4: Document the flag** in `.env.example` as `TOPICAL_MAP_ACTIVATION_ENABLED=false`, server-only, strategy-selection-only, and independent of live execution.
- [ ] **Step 5: Run GREEN** focused tests, both typechecks, lint, and `git diff --check`; expect zero failures/errors.
- [ ] **Step 6: Commit** `feat(topical-map): gate production strategy activation`.

### Task 2: Activation-authorized immutable contract revision

**Files:**
- Modify: `lib/topical-map/contract.ts`
- Modify: `__tests__/lib/topical-map/contract.test.ts`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/agriko-topical-map-compilation-contract-2026-07-13.json`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/agriko-topical-map-compilation-contract-2026-07-13-review.md`
- Create: `/home/sean/Agriko/shopify-theme/docs/seo/strategy-package-manifest-2026-07-13.json`
- Test: `__tests__/lib/topical-map/manifest.test.ts`
- Test: `__tests__/lib/topical-map/contract-integrity.test.ts`
- Test: `__tests__/lib/topical-map/compiler.test.ts`
- Test: `__tests__/lib/topical-map/validator.test.ts`

**Interfaces:**
- Consumes: existing contract revision 2 and five unchanged semantic artifact hashes.
- Produces: revision 3 contract with `activationEligible: true`, `runtimeActivationAuthorized: true`, `active: false`, `liveExecutionAuthorized: false`, and a new content-addressed six-artifact package identity.

- [ ] **Step 1: Write RED parser tests** requiring approved activation to have named approval identity/time, `validationImportEligible: true`, both activation flags equal, `active: false` before runtime activation, and live execution false.
- [ ] **Step 2: Run RED** with `npm test -- __tests__/lib/topical-map/contract.test.ts`; expect the activation-authorized fixture to fail under the literal-false schema.
- [ ] **Step 3: Replace literal-false activation fields** with booleans plus a `superRefine` invariant that rejects partial authorization, pending activation, pre-marked active packages, or live-execution authorization.
- [ ] **Step 4: Create revision 3** by copying revision 2 and changing only approval/review metadata necessary for strategy-selection authorization; retain every rule, locator, coverage unit, ambiguity disposition, and semantic hash.
- [ ] **Step 5: Record operator approval** in the review file, compute the new contract SHA-256, create the new manifest referencing the unchanged five hashes plus new contract hash, and compute its canonical package SHA-256 using the existing manifest tooling.
- [ ] **Step 6: Run GREEN** manifest, contract, integrity, compiler, and validator suites; assert 6 artifacts, 1,493 rules, 853 coverage units, zero validation issues, and the new exact hashes.
- [ ] **Step 7: Commit separately** in Autopilot (`feat(topical-map): accept activation-authorized contracts`) and theme (`docs(seo): authorize topical map strategy selection`).

### Task 3: Acceptance, deployment, import, and explicit activation

**Files:**
- Modify only GROW records after verified outcomes: `.mex/ROUTER.md`, `.mex/events/decisions.jsonl`, and the theme governance record if required.

**Interfaces:**
- Consumes: Task 1 runtime gate and Task 2 revision 3 package.
- Produces: one active `agrikoph.com` pointer to the revision 3 package and an activation audit record.

- [ ] **Step 1: Run the full local matrix**: `npm run db:generate`, `npm run verify:prisma-client`, `npm test`, `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, isolated-URL `npm run build`, `git diff --check`, and guarded `npm run test:postgres`; require all green.
- [ ] **Step 2: Commit and merge** coherent changes to local `main`, preserve unrelated work, and require a clean tree.
- [ ] **Step 3: Back up production**, verify the custom-format archive with `pg_restore --list`, and record size and SHA-256.
- [ ] **Step 4: Deploy** with `node scripts/git-deploy.mjs`; require matching local/origin/server commit, current migrations, active build ID, online PM2, and public health `ok`.
- [ ] **Step 5: Install exactly seven files** (manifest plus six artifacts) under a mode-0700 server directory; verify every artifact hash and package identity before setting `TOPICAL_MAP_STRATEGY_ROOT`.
- [ ] **Step 6: Import explicitly** through the private authenticated package route; require lifecycle `validated`, validation status `valid`, 6 artifacts, 1,493 compiled rules, and zero issues.
- [ ] **Step 7: Enable strategy selection only** by persisting `TOPICAL_MAP_ACTIVATION_ENABLED=true` while confirming `EXECUTE_APPROVED_LIVE_ENABLED=false`; recreate/restart PM2 without inherited overrides.
- [ ] **Step 8: Activate once** through the authenticated `SETTINGS_ADMIN` route with actor and reason provenance.
- [ ] **Step 9: Verify production**: the sole active pointer references the new package, lifecycle is `active`, validation remains valid, activation audit exists, proposal governance loads the active projection, PM2 is online, health is `ok`, and no Shopify/Meta execution occurred.
- [ ] **Step 10: Run GROW and commit/deploy the release record** so local, origin, server, and active build commits match.
