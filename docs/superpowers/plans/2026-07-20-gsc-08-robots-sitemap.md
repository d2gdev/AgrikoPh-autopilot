# GSC-08 Robots Sitemap Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagent dispatch is prohibited for this run.

**Goal:** Replace the invalid rendered robots directive `Sitemap: /sitemap.xml` with the absolute directive `Sitemap: https://agrikoph.com/sitemap.xml` through an approved, hash-locked Shopify Recommendation.

**Architecture:** Read and hash the published main theme's exact `templates/robots.txt.liquid` asset, derive a one-line literal-URL replacement from that captured value, and persist the complete approved payload in a Recommendation. Execution re-reads the same main-theme asset, rejects changed state, re-derives the exact transform, writes through Shopify Admin GraphQL, and accepts success only after matching read-back plus public and Search Console verification.

**Tech Stack:** Next.js 15, TypeScript 5.6, Prisma 6/PostgreSQL, Vitest 4, Shopify Admin GraphQL API, Liquid, Google Search Console authenticated UI, PM2.

## Global Constraints

- Every embedded API route must call `await requireAppAuth(req)` first; every cron route must call `requireCronAuth(req)` before acquiring its job lock.
- All database access uses `import { prisma } from "@/lib/db"`; never instantiate `PrismaClient`.
- Never execute a live Shopify write unless `EXECUTE_APPROVED_LIVE_ENABLED=true` and the exact Recommendation is `approved` or `override_approved`.
- The live precondition is theme `gid://shopify/OnlineStoreTheme/160524763362`, asset `templates/robots.txt.liquid`, and SHA-256 `295e7653a166c8a1edccf444b13b4e06ba699ac9479d011cb53dc574ee41b9f3`.
- The transformation owns only the exact source line `Sitemap: {{ shop.url }}/sitemap.xml` and replaces it with `Sitemap: https://agrikoph.com/sitemap.xml`.
- Preserve the user's dirty local Shopify theme work. The live mutation is derived from the Shopify Admin read, not the local theme checkout.
- Do not describe GSC-08 as fixed until Shopify read-back, the canonical public robots response, Search Console robots testing, the authenticated Autopilot recommendation UI, and the persisted Recommendation/AuditLog have all been inspected.

---

## File Structure

### Create

- `lib/recommendations/robots-sitemap.ts` — exact transform, Recommendation queueing, stale-state enforcement, and verified application.
- `scripts/queue-robots-sitemap-recommendation.ts` — dry-run-by-default operational entry point.
- `__tests__/lib/recommendations/robots-sitemap.test.ts` — pure transform, queue, and execution guards.
- `__tests__/scripts/queue-robots-sitemap-recommendation.test.ts` — CLI parsing and dry-run/apply behavior.

### Modify

- `lib/shopify-theme-assets.ts` — add a second narrowly allowed asset with typed read/write wrappers.
- `lib/executor.ts` — allowlist `fix_robots_sitemap_url`.
- `jobs/execute-approved.ts` — dispatch, audit, timeout recovery, and reconciliation for the exact robots action.
- `__tests__/lib/shopify-theme-assets.test.ts`
- `__tests__/lib/executor.test.ts`
- `__tests__/jobs/execute-approved.test.ts`
- `docs/seo/gsc-audit-2026-07-20.md`
- `.mex/ROUTER.md`
- `.mex/context/seo.md`
- `.mex/patterns/gsc-governed-remediation.md`
- `docs/planning-metrics.csv`

---

### Task 1: Exact Robots Asset Adapter and Transformation

**Files:**

- Modify: `lib/shopify-theme-assets.ts`
- Create: `lib/recommendations/robots-sitemap.ts`
- Test: `__tests__/lib/shopify-theme-assets.test.ts`
- Test: `__tests__/lib/recommendations/robots-sitemap.test.ts`

**Interfaces:**

- Consumes: existing `shopifyFetch`, Prisma `Recommendation`, latest `RawSnapshot` with source `gsc`.
- Produces:

```ts
export const ROBOTS_TEMPLATE_ASSET_KEY = "templates/robots.txt.liquid" as const;
export const CANONICAL_SITEMAP_URL = "https://agrikoph.com/sitemap.xml" as const;

export async function fetchMainThemeRobotsAsset(): Promise<
  ThemeAssetObservation<typeof ROBOTS_TEMPLATE_ASSET_KEY>
>;

export async function updateMainThemeRobotsAsset(input: {
  themeId: string;
  assetKey: typeof ROBOTS_TEMPLATE_ASSET_KEY;
  value: string;
}): Promise<ThemeAssetObservation<typeof ROBOTS_TEMPLATE_ASSET_KEY>>;

export function fixRobotsSitemapUrl(value: string): string;
export async function queueRobotsSitemapRecommendation(
  db: typeof prisma,
  input: { actor: string },
): Promise<{ recommendationId: string; created: boolean }>;
export async function applyApprovedRobotsSitemapRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>>;
```

- [ ] **Step 1: Write failing transform and adapter tests**

```ts
it("replaces only the one invalid dynamic sitemap directive", () => {
  const before = [
    "{% for group in robots.default_groups %}",
    "  {{- group.user_agent -}}",
    "{% endfor %}",
    "",
    "Sitemap: {{ shop.url }}/sitemap.xml",
    "",
  ].join("\n");
  expect(fixRobotsSitemapUrl(before)).toBe(before.replace(
    "Sitemap: {{ shop.url }}/sitemap.xml",
    "Sitemap: https://agrikoph.com/sitemap.xml",
  ));
});

it.each([
  "Sitemap: /sitemap.xml",
  "Sitemap: https://agrikoph.com/sitemap.xml",
  "Sitemap: {{ shop.url }}/sitemap.xml\nSitemap: {{ shop.url }}/sitemap.xml",
])("fails closed when the source does not contain exactly one approved line", (value) => {
  expect(() => fixRobotsSitemapUrl(value)).toThrow(/exactly one/i);
});
```

Mock Shopify GraphQL and assert the robots reader requests only `templates/robots.txt.liquid`; assert the robots writer rejects every other key, verifies the current published main theme, and returns only after content and SHA-256 read-back match.

- [ ] **Step 2: Run RED**

```bash
npm test -- __tests__/lib/shopify-theme-assets.test.ts __tests__/lib/recommendations/robots-sitemap.test.ts
```

Expected: FAIL because the robots constants and functions do not exist.

- [ ] **Step 3: Generalize the internal adapter without broadening public authority**

Use a generic observation type and private key-parameterized helpers:

```ts
export type ThemeAssetObservation<
  TKey extends AllowedThemeAssetKey = typeof HOME_SCHEMA_ASSET_KEY,
> = {
  themeId: string;
  themeRole: "main";
  assetKey: TKey;
  value: string;
  sha256: string;
};

async function readThemeAsset<TKey extends AllowedThemeAssetKey>(
  themeId: string,
  assetKey: TKey,
): Promise<ThemeAssetObservation<TKey>>;
```

Keep the public functions asset-specific. Build `themeFilesUpsert.files[0].filename` from the wrapper's literal key; do not export a caller-controlled general write function.

- [ ] **Step 4: Implement the exact Recommendation workflow**

Define the strict payload:

```ts
const ApprovedRobotsSitemap = z.object({
  themeId: z.string().startsWith("gid://shopify/OnlineStoreTheme/").max(100),
  assetKey: z.literal(ROBOTS_TEMPLATE_ASSET_KEY),
  beforeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  afterSha256: z.string().regex(/^[a-f0-9]{64}$/),
  afterValue: z.string().min(1).max(100_000),
}).strict();
```

Queue `platform: "shopify"`, `actionType: "fix_robots_sitemap_url"`, `targetEntityType: "theme_asset"`, `skillId: "gsc-robots-sitemap"`, `status: "pending"`, and a rationale that identifies GSC-08. On apply, require `status === "executing"` and the live flag, verify identity and hashes, accept an already-applied exact value idempotently, reject stale source state, re-derive `fixRobotsSitemapUrl(current.value)`, write through `updateMainThemeRobotsAsset`, and verify exact read-back.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- __tests__/lib/shopify-theme-assets.test.ts __tests__/lib/recommendations/robots-sitemap.test.ts
git add lib/shopify-theme-assets.ts lib/recommendations/robots-sitemap.ts __tests__/lib/shopify-theme-assets.test.ts __tests__/lib/recommendations/robots-sitemap.test.ts
git commit -m "feat: govern robots sitemap remediation"
```

Expected: focused tests pass; commit contains only the narrow adapter and workflow.

---

### Task 2: Executor Dispatch and Operational Queue Command

**Files:**

- Modify: `lib/executor.ts`
- Modify: `jobs/execute-approved.ts`
- Create: `scripts/queue-robots-sitemap-recommendation.ts`
- Modify: `__tests__/lib/executor.test.ts`
- Modify: `__tests__/jobs/execute-approved.test.ts`
- Create: `__tests__/scripts/queue-robots-sitemap-recommendation.test.ts`

**Interfaces:**

- Consumes: `applyApprovedRobotsSitemapRecommendation`, `queueRobotsSitemapRecommendation`, `fetchMainThemeRobotsAsset`, `fixRobotsSitemapUrl`.
- Produces:

```ts
export function parseQueueRobotsSitemapArguments(args: string[]): {
  apply: boolean;
};

export async function runQueueRobotsSitemapRecommendation(input: {
  apply: boolean;
  actor?: string;
}): Promise<Record<string, unknown>>;
```

- [ ] **Step 1: Write failing allowlist, dispatch, and CLI tests**

```ts
expect(isSupportedAction("shopify", "fix_robots_sitemap_url")).toBe(true);
expect(isSupportedAction("shopify", "update_theme_asset")).toBe(false);
```

Create an approved robots Recommendation fixture and assert `runExecuteApproved()` moves it to `executing`, calls only `applyApprovedRobotsSitemapRecommendation`, marks it `completed`, and writes `robots_sitemap_applied`. Add dry-run assertions that no Recommendation or Shopify mutation is created, and apply-mode assertions that queueing is invoked exactly once.

- [ ] **Step 2: Run RED**

```bash
npm test -- __tests__/lib/executor.test.ts __tests__/jobs/execute-approved.test.ts __tests__/scripts/queue-robots-sitemap-recommendation.test.ts
```

Expected: FAIL because the action is unsupported and neither dispatch nor CLI exists.

- [ ] **Step 3: Add the exact action to all executor lifecycle branches**

Add `fix_robots_sitemap_url` to the Shopify allowlist. Mirror the homepage schema branch with the robots-specific apply function and audit action names:

```ts
"robots_sitemap_applied"
"robots_sitemap_execution_timeout_reconciled"
"robots_sitemap_reconciliation_needed"
```

Dry-run must simulate without importing the live writer. Timeout recovery may complete only when the current robots asset exactly matches the approved `afterValue` and `afterSha256`; otherwise retain the existing failed/reconciliation behavior.

- [ ] **Step 4: Implement the dry-run-by-default queue command**

The only accepted flag is `--apply`. Dry-run fetches the main robots asset, derives the exact replacement, prints before/after hashes, and returns `recommendationCreated: false` and `liveMutationSent: false`. Apply mode queues a pending Recommendation with actor `script:gsc-robots-sitemap`.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- __tests__/lib/executor.test.ts __tests__/jobs/execute-approved.test.ts __tests__/scripts/queue-robots-sitemap-recommendation.test.ts
npm run typecheck
git add lib/executor.ts jobs/execute-approved.ts scripts/queue-robots-sitemap-recommendation.ts __tests__/lib/executor.test.ts __tests__/jobs/execute-approved.test.ts __tests__/scripts/queue-robots-sitemap-recommendation.test.ts
git commit -m "feat: execute approved robots sitemap fix"
```

Expected: focused tests and typecheck pass.

---

### Task 3: Deploy, Execute, Verify, and Record

**Files:**

- Modify: `docs/seo/gsc-audit-2026-07-20.md`
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/seo.md`
- Modify: `.mex/patterns/gsc-governed-remediation.md`
- Modify: `docs/planning-metrics.csv`

**Interfaces:**

- Consumes: production deployment workflow, authenticated Autopilot UI, Search Console robots tester.
- Produces: one completed Recommendation, matching AuditLog, live Shopify/public evidence, and GROW records.

- [ ] **Step 1: Run the pre-deploy verification gate**

```bash
npm test -- __tests__/lib/shopify-theme-assets.test.ts __tests__/lib/recommendations/robots-sitemap.test.ts __tests__/lib/executor.test.ts __tests__/jobs/execute-approved.test.ts __tests__/scripts/queue-robots-sitemap-recommendation.test.ts
npm run typecheck
npm run lint
npm run build
git status --short
```

Expected: every command exits zero; status contains only the plan/GROW edits intended for this branch and the ignored `node_modules` symlink.

- [ ] **Step 2: Deploy the exact commit and prove deployment health**

Push the branch, deploy the saved commit through the established production procedure, and record:

```text
local commit == server commit
active build artifact references that commit
PM2 agriko-autopilot status == online
https://autopilot.agrikoph.com/api/health returns HTTP 200
```

- [ ] **Step 3: Queue and approve the exact Recommendation**

Run production dry-run first, then `--apply`. Inspect the pending item in the authenticated Autopilot UI, confirm its target asset and before/after hashes match the production observation, and approve that exact Recommendation as the operator.

- [ ] **Step 4: Execute through the governed live boundary**

Invoke the approved-execution job with production's existing cron authentication. Confirm the Recommendation transitions `approved -> executing -> completed`, and confirm an AuditLog row with `action: "robots_sitemap_applied"` records the verified before/after hashes.

- [ ] **Step 5: Verify all live evidence gates**

Read `templates/robots.txt.liquid` back through Shopify Admin and verify its exact hash and literal URL. Fetch `https://agrikoph.com/robots.txt` with cache-bypass and canonical requests until the output contains exactly:

```text
Sitemap: https://agrikoph.com/sitemap.xml
```

Open the authenticated Search Console robots tester, request a fresh test, and confirm line 165 no longer has `Invalid sitemap URL detected`; the four ignored `Crawl-delay` warnings may remain because they are Shopify-generated and non-blocking. Re-open the authenticated Autopilot recommendation UI and trace the displayed completed item to its API response, Recommendation row, and AuditLog.

- [ ] **Step 6: Record GROW evidence and commit**

Update the GSC audit with timestamps, hashes, Recommendation/AuditLog identifiers, public response, and Search Console result. Update `.mex/ROUTER.md`, `.mex/context/seo.md`, and `.mex/patterns/gsc-governed-remediation.md`; append one planning-metrics row; run:

```bash
mex log "GSC-08 used a hash-locked governed theme-asset recommendation because Shopify rendered shop.url empty in robots.txt"
git add docs/seo/gsc-audit-2026-07-20.md .mex/ROUTER.md .mex/context/seo.md .mex/patterns/gsc-governed-remediation.md docs/planning-metrics.csv docs/superpowers/plans/2026-07-20-gsc-08-robots-sitemap.md
git commit -m "docs: record GSC-08 remediation evidence"
```

Expected: the record distinguishes the four non-critical Shopify `Crawl-delay` warnings from the resolved absolute-sitemap error and contains no unsupported clean-audit claim.
