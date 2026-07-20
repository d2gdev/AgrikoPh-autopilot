# Shopify Theme Page-Cache Flush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a hash-verified duplicate of the current Shopify main theme through an approved Recommendation so Shopify's stale rendered page cache is replaced without rolling back Git improvements.

**Architecture:** A fixed-scope Shopify adapter will duplicate, poll, and publish themes while the existing theme-asset adapter verifies the exact four Git-authoritative files on any named theme ID. A separate Recommendation module will freeze source identity and hashes, fail closed on drift, retain idempotent recovery by duplicate name, and return a bounded receipt. The normal executor remains the only live mutation boundary.

**Tech Stack:** TypeScript, Shopify Admin GraphQL API, Prisma/PostgreSQL, Zod, Vitest, Next.js production deployment, Shopify Liquid rendered verification.

## Global Constraints

- Never write Shopify unless `EXECUTE_APPROVED_LIVE_ENABLED=true` and the Recommendation is `approved` or `override_approved`.
- The action is fixed to the four `THEME_SOURCE_SYNC_ASSET_KEYS`; no caller-selected files or content.
- Duplicate only the exact current main theme, verify the duplicate before publish, and never delete the previous theme.
- Retain theme commit `8ff4626583861e70a542a2b51f67989429d52ea3` and its approved hashes as the source authority.
- Completion requires rendered storefront evidence, not Admin API read-back alone.
- After publish, set `SHOPIFY_THEME_ID` to the new numeric main-theme ID in `/home/sean/Agriko/auto-pilot/.env` and `/home/sean/Agriko/shopify-theme/.env`; update `/opt/autopilot/.env` only if it contains that key.
- Do not perform or require a Cloudflare mutation.

---

### Task 1: Fixed-scope Shopify theme lifecycle adapter

**Files:**
- Create: `lib/shopify-theme-cache.ts`
- Modify: `lib/shopify-theme-assets.ts`
- Create: `__tests__/lib/shopify-theme-cache.test.ts`
- Modify: `__tests__/lib/shopify-theme-assets.test.ts`

**Interfaces:**
- Produces: `fetchShopifyThemes(): Promise<ShopifyThemeIdentity[]>`
- Produces: `fetchExactlyOneMainTheme(): Promise<ShopifyThemeIdentity>`
- Produces: `duplicateShopifyTheme(input: { sourceThemeId: string; name: string }): Promise<ShopifyThemeIdentity>`
- Produces: `waitForShopifyThemeReady(themeId: string): Promise<ShopifyThemeIdentity>`
- Produces: `publishShopifyTheme(themeId: string): Promise<ShopifyThemeIdentity>`
- Produces: `fetchThemeSourceAssets(themeId: string): Promise<ThemeAssetObservation<ThemeSourceSyncAssetKey>[]>`

- [ ] **Step 1: Write failing adapter tests**

Add tests that assert:

```ts
expect(await fetchExactlyOneMainTheme()).toMatchObject({
  id: sourceThemeId,
  role: "MAIN",
  processing: false,
});
expect(shopifyFetch.mock.calls[0]?.[0]).toContain("themes(first: 50)");

expect(await duplicateShopifyTheme({
  sourceThemeId,
  name: duplicateName,
})).toMatchObject({ id: duplicateThemeId, name: duplicateName });
expect(shopifyFetch.mock.calls[0]?.[1]).toEqual({
  id: sourceThemeId,
  name: duplicateName,
});

await waitForShopifyThemeReady(duplicateThemeId);
expect(shopifyFetch).toHaveBeenCalledTimes(3);

expect(await publishShopifyTheme(duplicateThemeId)).toMatchObject({
  id: duplicateThemeId,
  role: "MAIN",
});
```

Extend the asset test to call `fetchThemeSourceAssets(duplicateThemeId)` and
assert that the query contains only `THEME_SOURCE_SYNC_ASSET_KEYS`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run __tests__/lib/shopify-theme-cache.test.ts __tests__/lib/shopify-theme-assets.test.ts
```

Expected: FAIL because the lifecycle module and named-theme asset reader do not
exist.

- [ ] **Step 3: Implement the adapter**

Implement fixed GraphQL operations:

```ts
export type ShopifyThemeIdentity = {
  id: string;
  name: string;
  role: "MAIN" | "UNPUBLISHED" | "DEVELOPMENT";
  processing: boolean;
  updatedAt: string;
};

export async function duplicateShopifyTheme(input: {
  sourceThemeId: string;
  name: string;
}): Promise<ShopifyThemeIdentity> {
  // themeDuplicate(id: $id, name: $name)
  // reject userErrors, missing theme, unexpected name, or MAIN role
}

export async function waitForShopifyThemeReady(
  themeId: string,
): Promise<ShopifyThemeIdentity> {
  // bounded polling; require the same ID and return only at processing=false
}

export async function publishShopifyTheme(
  themeId: string,
): Promise<ShopifyThemeIdentity> {
  // themePublish(id: $id); reject errors or a mismatched returned ID
}
```

Export `fetchThemeSourceAssets(themeId)` from
`lib/shopify-theme-assets.ts`; it must always read the fixed four keys and
accept no asset-key argument.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the command from Step 2. Expected: both files pass with no warnings.

- [ ] **Step 5: Commit the adapter**

```bash
git add lib/shopify-theme-cache.ts lib/shopify-theme-assets.ts \
  __tests__/lib/shopify-theme-cache.test.ts \
  __tests__/lib/shopify-theme-assets.test.ts
git commit -m "feat: add verified Shopify theme lifecycle"
```

### Task 2: Governed cache-flush Recommendation

**Files:**
- Create: `lib/recommendations/theme-cache-flush.ts`
- Create: `__tests__/lib/recommendations/theme-cache-flush.test.ts`

**Interfaces:**
- Consumes: Task 1 lifecycle and fixed asset readers.
- Produces: `queueThemeCacheFlushRecommendation(db, input)`
- Produces: `applyApprovedThemeCacheFlushRecommendation(recommendation)`
- Input: `{ actor: string; sourceCommit: string; sourceValues: Record<ThemeSourceSyncAssetKey, string>; duplicateName: string }`
- Receipt: `{ sourceThemeId; publishedThemeId; duplicateName; sourceCommit; hashes; alreadyApplied; verifiedAt }`

- [ ] **Step 1: Write failing Recommendation tests**

Cover the following exact behaviors:

```ts
it("queues exact source hashes without mutating Shopify", async () => {
  const result = await queueThemeCacheFlushRecommendation(db, input);
  expect(result.created).toBe(true);
  expect(JSON.parse(created.proposedValue).assets).toEqual(
    THEME_SOURCE_SYNC_ASSET_KEYS.map((assetKey) => ({
      assetKey,
      sha256: sha256(sourceValues[assetKey]),
    })),
  );
  expect(theme.duplicate).not.toHaveBeenCalled();
  expect(theme.publish).not.toHaveBeenCalled();
});

it("rejects source drift before duplication", async () => {
  await expect(apply(recommendation)).rejects.toThrow(/changed after approval/i);
  expect(theme.duplicate).not.toHaveBeenCalled();
});

it("verifies duplicate hashes before publish", async () => {
  await apply(recommendation);
  expect(theme.readAssets).toHaveBeenCalledWith(duplicateThemeId);
  expect(theme.publish).toHaveBeenCalledWith(duplicateThemeId);
});

it("does not publish a mismatched duplicate", async () => {
  await expect(apply(recommendation)).rejects.toThrow(/duplicate.*hash/i);
  expect(theme.publish).not.toHaveBeenCalled();
});

it("accepts an already-published verified duplicate idempotently", async () => {
  expect(await apply(recommendation)).toMatchObject({
    publishedThemeId: duplicateThemeId,
    alreadyApplied: true,
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
npm test -- --run __tests__/lib/recommendations/theme-cache-flush.test.ts
```

Expected: FAIL because the Recommendation module does not exist.

- [ ] **Step 3: Implement queue and execution**

Use a strict Zod payload with ordered fixed assets. Queue only when current
main bytes equal `sourceValues`; store hashes but not bytes. During execution,
revalidate main identity and hashes, reuse at most one theme with the approved
duplicate name, duplicate when absent, poll readiness, verify duplicate hashes,
publish, re-discover the unique main theme, and verify hashes again.

Write an audit row immediately after creating a duplicate:

```ts
await prisma.auditLog.create({
  data: {
    actor: "system",
    action: "theme_cache_flush_duplicate_created",
    entityType: "recommendation",
    entityId: recommendation.id,
    after: { sourceThemeId, duplicateThemeId, duplicateName },
  },
});
```

Never delete a theme or automatically republish the former main theme.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the command from Step 2. Expected: all cache-flush Recommendation tests pass.

- [ ] **Step 5: Commit the Recommendation**

```bash
git add lib/recommendations/theme-cache-flush.ts \
  __tests__/lib/recommendations/theme-cache-flush.test.ts
git commit -m "feat: govern Shopify theme cache flush"
```

### Task 3: Executor integration and recovery

**Files:**
- Modify: `lib/executor.ts`
- Modify: `jobs/execute-approved.ts`
- Modify: `__tests__/lib/executor.test.ts`
- Modify: `__tests__/jobs/execute-approved.test.ts`

**Interfaces:**
- Consumes: `applyApprovedThemeCacheFlushRecommendation`.
- Produces: supported action `flush_shopify_theme_page_cache`.
- Produces audit action: `theme_page_cache_flushed`.

- [ ] **Step 1: Write failing executor tests**

Add assertions:

```ts
expect(isSupportedAction(
  "shopify",
  "flush_shopify_theme_page_cache",
)).toBe(true);

expect(themeCacheFlush.apply).toHaveBeenCalledWith(
  expect.objectContaining({
    id: recommendation.id,
    status: "executing",
  }),
);
expect(prisma.auditLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    action: "theme_page_cache_flushed",
    entityId: recommendation.id,
  }),
});
```

Also cover `recommendationId` scoping so only the exact approved cache-flush
Recommendation is considered.

- [ ] **Step 2: Run the tests and verify RED**

```bash
npm test -- --run __tests__/lib/executor.test.ts __tests__/jobs/execute-approved.test.ts
```

Expected: FAIL because the action is unsupported and has no job branch.

- [ ] **Step 3: Implement executor routing**

Add the fixed action to the Shopify allowlist. Add dry-run, live execution, and
stale-recovery branches in `jobs/execute-approved.ts`, following the existing
`sync_theme_source_assets` pattern. Persist the bounded receipt and mark the
Recommendation executed only after the action returns successfully.

- [ ] **Step 4: Run related and full verification**

```bash
npm test -- --run __tests__/lib/shopify-theme-cache.test.ts \
  __tests__/lib/shopify-theme-assets.test.ts \
  __tests__/lib/recommendations/theme-cache-flush.test.ts \
  __tests__/lib/executor.test.ts \
  __tests__/jobs/execute-approved.test.ts
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: all commands pass; no skipped test is introduced by this change.

- [ ] **Step 5: Commit executor integration**

```bash
git add lib/executor.ts jobs/execute-approved.ts \
  __tests__/lib/executor.test.ts __tests__/jobs/execute-approved.test.ts
git commit -m "feat: execute approved Shopify cache flush"
```

### Task 4: Deploy, approve, execute, and reconcile environment IDs

**Files:**
- Modify after publish: `/home/sean/Agriko/auto-pilot/.env`
- Modify after publish: `/home/sean/Agriko/shopify-theme/.env`
- Conditionally modify: `/opt/autopilot/.env`

**Interfaces:**
- Consumes: exact Git theme source files and the deployed Recommendation action.
- Produces: one executed Recommendation, one new main theme, and synchronized theme IDs.

- [ ] **Step 1: Push and deploy verified Autopilot**

```bash
git push origin main
node scripts/git-deploy.mjs
```

Record local/origin/server commit, `.next/BUILD_ID`, PM2 status/start time, and
public health.

- [ ] **Step 2: Queue and inspect the exact Recommendation**

Copy the four theme source files to a mode-0700 production temporary directory.
Call `queueThemeCacheFlushRecommendation` with source commit
`8ff4626583861e70a542a2b51f67989429d52ea3` and a unique
`autopilot-cache-flush-*` name. Read back status, guard, source theme ID,
duplicate name, and hashes; do not print bytes or credentials.

- [ ] **Step 3: Approve and execute only that Recommendation**

Approve through `/api/recommendations/{id}/approve` using authenticated
server-side API-key authority and a review note naming the source theme,
duplicate name, commit, and hashes. Run:

```ts
executeApprovedHandler({
  liveRequested: true,
  triggeredBy: "codex:user-approved-shopify-cache-flush",
  recommendationId,
});
```

Require `considered=1`, `executed=1`, and all failure/skip/block counters zero.

- [ ] **Step 4: Synchronize theme IDs**

After Shopify reports exactly one `MAIN` theme and it is the verified duplicate,
update only the `SHOPIFY_THEME_ID` line in:

```text
/home/sean/Agriko/auto-pilot/.env
/home/sean/Agriko/shopify-theme/.env
```

If `/opt/autopilot/.env` already contains `SHOPIFY_THEME_ID`, replace it and
restart PM2; otherwise do not add an unused production variable. Verify all
configured values equal the new numeric theme ID without printing any other
environment values.

- [ ] **Step 5: Remove temporary files**

Delete the production temporary source directory and verify it no longer
exists.

### Task 5: Rendered acceptance, GROW, and final release evidence

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/patterns/gsc-governed-remediation.md`
- Modify: `docs/planning-metrics.csv`
- Modify: `/home/sean/Agriko/shopify-theme/.mex/AGENTS.md`
- Modify: `/home/sean/Agriko/shopify-theme/.mex/patterns/debug-live-not-updating.md`
- Modify: `/home/sean/Agriko/shopify-theme/.mex/patterns/push-to-shopify.md`
- Modify: `/home/sean/Agriko/shopify-theme/docs/seo/seo-release-annotations.csv`

**Interfaces:**
- Consumes: production receipt, public responses, repository state.
- Produces: durable runbook and release evidence.

- [ ] **Step 1: Verify storefront behavior**

Require:

```json
{
  "articleStatus": 200,
  "h1Count": 1,
  "torStoryCount": 1,
  "torTitleCount": 1,
  "legacyTopArticleCount": 0,
  "homepageH1Count": 1,
  "absoluteSitemapCount": 1,
  "relativeSitemapCount": 0
}
```

Capture response headers proving the new main-theme ID. If rendered parity does
not pass, keep the issue open and return to systematic debugging.

- [ ] **Step 2: Verify governed and operational evidence**

Read the Recommendation, JobRun, duplicate-created audit, approval audit, and
success audit. Recheck Admin hashes on the new main theme, production health,
PM2, build ID, and matching commits.

- [ ] **Step 3: Run GROW**

Record the actual cache behavior and exact remedy in both repositories. Replace
stale theme-ID facts with the new ID, append the required SEO release annotation,
append one planning-metrics row, bump scaffold `last_updated`, and run `mex log`
where rationale matters.

- [ ] **Step 4: Commit, push, and deploy final documentation**

Commit Autopilot and theme documentation separately, push both `main` branches,
then deploy the final Autopilot documentation commit so local, origin, and
server commits match. Re-run health, build, PM2, rendered storefront, worktree,
branch, and clean-status verification.

