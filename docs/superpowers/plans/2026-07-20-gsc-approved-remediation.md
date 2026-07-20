# Approved Google Search Console Remediation Implementation Plan

**Execution status (2026-07-20):** Implemented and deployed. GSC-01, GSC-02,
GSC-04, and GSC-07 passed their live evidence gates. GSC-03 passed theme asset
read-back and cache-bypass rendering but is still pending canonical storefront
cache propagation and a fresh Google crawl. GSC-05's sitemap passed and two
priority URLs are now indexed; 17 URLs remain pending Google processing because
the Request Indexing daily quota was exhausted. GSC-06 was retained because
Workspace dependency verification was unavailable. A newly discovered relative
robots.txt sitemap directive is recorded as unapproved GSC-08 in the audit.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagent dispatch is prohibited for this run.

**Goal:** Remediate approved findings GSC-01 through GSC-05 and GSC-07, and remove GSC-06 only if Google Workspace and Merchant Center dependency checks prove the unused token is safe to remove.

**Architecture:** Normalize every GSC reporting window to an inclusive UTC calendar-day contract and persist a same-window, dimensionless property aggregate alongside query/page evidence. Route every Shopify mutation through an approved Recommendation: redirect work remains bound to a new immutable topical-map revision and Store Task executor, while the homepage schema repair uses a narrowly typed, hash-locked theme-asset recommendation. Use the Search Console API for sitemap submission and read-back; use authenticated Search Console UI only for Request Indexing and ownership-token operations that have no supported equivalent API.

**Tech Stack:** Next.js 15, TypeScript 5.6, Prisma 6/PostgreSQL, Vitest 4, Google Search Console API, Google Merchant API, Shopify Admin API, Liquid, Node test runner, PM2.

## Global Constraints

- Every embedded API route must call `await requireAppAuth(req)` first; every cron route must call `requireCronAuth(req)` before acquiring its job lock.
- All database access uses `import { prisma } from "@/lib/db"`; never instantiate `PrismaClient`.
- Never execute a live Shopify write unless `EXECUTE_APPROVED_LIVE_ENABLED=true` and the exact Recommendation is `approved` or `override_approved`.
- Keep query, page, and query/page Search Analytics rows as evidence only; property total cards require a dimensionless aggregate from the same exact window.
- Search Analytics `startDate` and `endDate` are inclusive Pacific-time reporting dates. A 28-day period contains 28 calendar dates: `end - 27 days` through `end`.
- Do not use the Indexing API for ordinary Shopify pages. It is restricted to JobPosting and livestream BroadcastEvent pages.
- Topical-map import and activation remain separate audited operations. Redirect Store Tasks execute only after the new package is active, each task is approved, and current Shopify absence is revalidated.
- Do not overwrite the dirty Shopify theme files unrelated to this task. The schema repair owns only `snippets/schema-global-jsonld.liquid`.
- Do not rewrite turmeric dosage or safety content without satisfying the active medical-review gate.
- Do not remove the unused Search Console ownership token unless Merchant Center remains claimed/verified and authenticated Workspace dependency inspection proves the token is not required.
- Do not claim a URL is indexed until URL Inspection returns `Submitted and indexed`.

---

## File Structure

### Autopilot files to create

- `lib/seo/gsc-window.ts` — pure UTC reporting-window construction.
- `lib/shopify-theme-assets.ts` — narrow live-theme asset observation/update/read-back adapter.
- `lib/recommendations/homepage-schema.ts` — exact homepage OfferCatalog transformation, queueing, stale-state checks, and verified application.
- `scripts/queue-homepage-schema-recommendation.ts` — dry-run-by-default operational entry point for the one approved schema repair.
- `scripts/submit-gsc-sitemap.ts` — explicit root-sitemap submit/read-back command.
- `__tests__/lib/seo/gsc-window.test.ts`
- `__tests__/lib/recommendations/homepage-schema.test.ts`
- `__tests__/lib/shopify-theme-assets.test.ts`

### Autopilot files to modify

- `lib/connectors/gsc.ts`
- `jobs/fetch-seo-data.ts`
- `jobs/fetch-gsc-data.ts`
- `jobs/snapshot-seo-history.ts`
- `lib/seo/data.ts`
- `lib/seo/snapshot.ts`
- `lib/seo/trends.ts`
- `lib/seo/types.ts`
- `app/api/seo/route.ts`
- `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OverviewPanel.tsx`
- `lib/executor.ts`
- `jobs/execute-approved.ts`
- `scripts/seed-seo-follow-up-tasks.ts`
- focused tests under `__tests__/jobs`, `__tests__/lib/seo`, `__tests__/components`, and `__tests__/scripts`
- GROW records under `.mex/`

### Shopify theme files to create

- `scripts/build-gsc-redirect-amendment.mjs`
- `tests/gsc-redirect-amendment.test.mjs`
- `docs/seo/packages/2026-07-20-gsc-redirects/` — manifest plus the six immutable package artifacts.

### Shopify theme files to modify

- `snippets/schema-global-jsonld.liquid`
- `tests/schema-maximization-source.test.mjs`
- `docs/seo/seo-release-annotations.csv`
- GROW records available in the theme repository

---

### Task 1: Inclusive GSC reporting windows

**Files:**

- Create: `lib/seo/gsc-window.ts`
- Create: `__tests__/lib/seo/gsc-window.test.ts`
- Modify: `jobs/fetch-seo-data.ts`
- Modify: `jobs/fetch-gsc-data.ts`
- Modify: `__tests__/jobs/seo-refresh-jobs.test.ts`

**Interfaces:**

```ts
export type GscReportingWindow = { start: Date; end: Date };

export function buildGscReportingWindows(input: {
  capturedAt: Date;
  lagDays: number;
  windowDays: number;
}): { current: GscReportingWindow; previous: GscReportingWindow };
```

The returned dates are UTC midnight calendar dates. `current.end` is the UTC date `lagDays` before capture, `current.start` is `windowDays - 1` days earlier, `previous.end` is one day before `current.start`, and `previous.start` is `windowDays - 1` days before `previous.end`.

- [ ] **Step 1: Write failing pure window tests**

```ts
it("builds adjacent inclusive 28-day UTC windows", () => {
  const result = buildGscReportingWindows({
    capturedAt: new Date("2026-07-20T14:23:00.000Z"),
    lagDays: 3,
    windowDays: 28,
  });
  expect(result.current).toEqual({
    start: new Date("2026-06-20T00:00:00.000Z"),
    end: new Date("2026-07-17T00:00:00.000Z"),
  });
  expect(result.previous).toEqual({
    start: new Date("2026-05-23T00:00:00.000Z"),
    end: new Date("2026-06-19T00:00:00.000Z"),
  });
});
```

Also assert 1-day windows, non-midnight captures, nonnegative lag normalization, exact inclusive day counts, and zero overlap.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- __tests__/lib/seo/gsc-window.test.ts
```

Expected: FAIL because `buildGscReportingWindows` does not exist.

- [ ] **Step 3: Implement the pure helper**

Use `Date.UTC`, integer-clamped `lagDays`, and integer-clamped `windowDays`; do not subtract milliseconds from arbitrary capture timestamps.

- [ ] **Step 4: Replace both job-local calculations**

`fetch-seo-data` consumes `current` and `previous`. `fetch-gsc-data` consumes `current`. Persist and send the exact UTC-midnight dates returned by the helper.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- __tests__/lib/seo/gsc-window.test.ts __tests__/jobs/seo-refresh-jobs.test.ts
```

Expected: all focused tests pass and the prior 29-day expectation is replaced by `2026-06-01` through `2026-06-28` for a July 1 capture with a three-day lag.

---

### Task 2: Dimensionless property totals and truthful SEO Pilot cards

**Files:**

- Modify: `lib/connectors/gsc.ts`
- Modify: `jobs/fetch-gsc-data.ts`
- Modify: `lib/seo/snapshot.ts`
- Modify: `lib/seo/data.ts`
- Modify: `lib/seo/trends.ts`
- Modify: `lib/seo/types.ts`
- Modify: `jobs/snapshot-seo-history.ts`
- Modify: `app/api/seo/route.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/types.ts`
- Modify: `app/(embedded)/(seo-pillar)/seo-pillar/components/panels/OverviewPanel.tsx`
- Modify: `__tests__/lib/connectors/gsc.test.ts`
- Modify: `__tests__/lib/seo/data.test.ts`
- Modify: `__tests__/lib/seo/trends.test.ts`
- Modify: `__tests__/jobs/seo-refresh-jobs.test.ts`
- Modify: `__tests__/components/seo-pilot-responsive.test.ts`

**Interfaces:**

```ts
export type GscPropertyTotals = {
  clicks: number;
  impressions: number;
  avgCtr: number;
  avgPosition: number;
};

export async function fetchGscPropertyTotals(
  opts: { start: Date; end: Date },
): Promise<GscPropertyTotals | null>;
```

`fetchGscData` returns:

```ts
{
  topQueries: GscQueryRow[];
  propertyTotals: GscPropertyTotals | null;
  fetchedAt: string;
}
```

`LatestGscData` and `PreviousGscData` expose `propertyTotals` plus provenance `"dimensionless_property_aggregate" | "unavailable"`.

- [ ] **Step 1: Write failing connector tests**

Assert the aggregate request contains finalized dates, no `dimensions`, no page/query filters, and returns the single row as numeric totals. Assert a missing row returns `null`.

- [ ] **Step 2: Run RED**

```bash
npm test -- __tests__/lib/connectors/gsc.test.ts
```

Expected: FAIL because `fetchGscPropertyTotals` is absent.

- [ ] **Step 3: Implement the dimensionless request**

Use the existing service-account auth and Search Analytics endpoint:

```ts
const body = {
  startDate: since,
  endDate: until,
  dataState: "final",
  rowLimit: 1,
};
```

Do not add dimensions or infer totals from query rows.

- [ ] **Step 4: Persist totals with the existing raw GSC snapshot**

`fetch-seo-data` already upserts `source="gsc"` and will persist the expanded `fetchGscData` payload. `fetch-gsc-data` must fetch the property aggregate and query/page evidence together, upsert the same `source="gsc"` window payload, and retain query/page normalization in `GscQuery`.

- [ ] **Step 5: Write failing selection and trend tests**

Prove:

- exact-window normalized query/page rows can use exact-window raw `propertyTotals`;
- a mismatched window cannot lend totals;
- missing aggregate totals stay unavailable rather than falling back to query sums;
- current and previous trend cards use supplied aggregates, while mover calculations still use dimensioned query evidence;
- SEO history persists property totals, not query-row sums.

- [ ] **Step 6: Run RED**

```bash
npm test -- __tests__/lib/seo/data.test.ts __tests__/lib/seo/trends.test.ts __tests__/jobs/seo-refresh-jobs.test.ts
```

Expected: new aggregate/provenance assertions fail.

- [ ] **Step 7: Implement selection and presentation**

Add an exact-window raw snapshot lookup in `lib/seo/snapshot.ts`. Extend `computeTrends` to accept optional aggregate overrides:

```ts
export function computeTrends(
  current: GscQueryRow[],
  previous: GscQueryRow[] | null,
  currentFetchedAt: string | null,
  previousFetchedAt: string | null,
  currentTotals: SeoTotals | null,
  previousTotals: SeoTotals | null,
): SeoTrends;
```

Use the overrides verbatim for total cards. Keep query evidence for movers. When the aggregate is missing, expose `current: null`; the UI renders `—` and states that the property aggregate is unavailable.

- [ ] **Step 8: Run GREEN**

```bash
npm test -- __tests__/lib/connectors/gsc.test.ts __tests__/lib/seo/data.test.ts __tests__/lib/seo/trends.test.ts __tests__/jobs/seo-refresh-jobs.test.ts __tests__/components/seo-pilot-responsive.test.ts
```

Expected: all focused tests pass.

---

### Task 3: Governed homepage schema recommendation

**Files:**

- Create: `lib/shopify-theme-assets.ts`
- Create: `lib/recommendations/homepage-schema.ts`
- Create: `scripts/queue-homepage-schema-recommendation.ts`
- Create: `__tests__/lib/shopify-theme-assets.test.ts`
- Create: `__tests__/lib/recommendations/homepage-schema.test.ts`
- Modify: `lib/executor.ts`
- Modify: `jobs/execute-approved.ts`
- Modify: `__tests__/jobs/execute-approved.test.ts`
- Modify: `/home/sean/Agriko/shopify-theme/tests/schema-maximization-source.test.mjs`
- Modify: `/home/sean/Agriko/shopify-theme/snippets/schema-global-jsonld.liquid`

**Interfaces:**

```ts
export type ThemeAssetObservation = {
  themeId: string;
  themeRole: "main";
  assetKey: "snippets/schema-global-jsonld.liquid";
  value: string;
  sha256: string;
};

export async function fetchMainThemeSchemaAsset(): Promise<ThemeAssetObservation>;
export async function updateMainThemeSchemaAsset(input: {
  themeId: string;
  assetKey: string;
  value: string;
}): Promise<ThemeAssetObservation>;

export function removeHomepageOfferCatalog(value: string): string;
export async function queueHomepageSchemaRecommendation(
  db: typeof prisma,
  input: { actor: string },
): Promise<{ recommendationId: string; created: boolean }>;
export async function applyApprovedHomepageSchemaRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>>;
```

The exact recommendation action is `remove_homepage_offer_catalog`. Its serialized payload contains the theme ID, fixed asset key, before SHA-256, after SHA-256, and exact after bytes.

- [ ] **Step 1: Write the failing Liquid source test**

Assert `schema-global-jsonld.liquid` contains the valid `#featured-products` `ItemList`, but contains neither `hasOfferCatalog` nor an `OfferCatalog` node.

- [ ] **Step 2: Run RED**

```bash
node --test tests/schema-maximization-source.test.mjs
```

Expected: FAIL on the two OfferCatalog assertions.

- [ ] **Step 3: Remove only the incomplete homepage OfferCatalog**

Delete the Organization `hasOfferCatalog` reference and the homepage OfferCatalog block. Preserve the existing homepage ItemList and all unrelated schema nodes.

- [ ] **Step 4: Run theme GREEN**

```bash
node --test tests/schema-maximization-source.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write failing adapter and recommendation tests**

Prove:

- main-theme discovery rejects zero or multiple main themes;
- only the fixed schema asset key is readable/writable;
- the transformation fails unless each approved block appears exactly once;
- queueing stores exact before/after hashes in a pending Shopify Recommendation;
- applying requires action/platform/status identity, live flag, exact current theme/asset/hash, exact approved after hash, and read-back equality;
- stale bytes fail before mutation;
- post-write mismatch produces a bounded verification error without leaking asset bytes.

- [ ] **Step 6: Run RED**

```bash
npm test -- __tests__/lib/shopify-theme-assets.test.ts __tests__/lib/recommendations/homepage-schema.test.ts __tests__/jobs/execute-approved.test.ts
```

Expected: FAIL because the adapter and action do not exist.

- [ ] **Step 7: Implement the narrow action**

Use the Shopify Admin API with the existing server-side token and token-refresh boundary. The adapter must discover the `main` theme instead of hardcoding an ID and must read back the exact asset after the write.

Add `remove_homepage_offer_catalog` to the Shopify action allowlist and dispatch it in `execute-approved` alongside the existing image-alt and topical-map special cases. Generic Meta guardrail derivation must not run for this exact action.

- [ ] **Step 8: Run GREEN**

Run the focused tests from Step 6 and require all pass.

---

### Task 4: Immutable topical-map redirect amendment

**Files:**

- Create: `/home/sean/Agriko/shopify-theme/scripts/build-gsc-redirect-amendment.mjs`
- Create: `/home/sean/Agriko/shopify-theme/tests/gsc-redirect-amendment.test.mjs`
- Generate: `/home/sean/Agriko/shopify-theme/docs/seo/packages/2026-07-20-gsc-redirects/*`

**Interfaces:**

The builder consumes the active package at `docs/seo/packages/2026-07-18-p0-links` with package SHA-256 `33ad636f7451a766ec05f56143acdf205f522fb285ad7e8c82784936ed4d62ac`.

It produces contract revision `6`, strategy version `2026-07-20`, 15 added redirect coverage units and rules, and no other semantic rule change. The exact mapping list is copied from `docs/seo/gsc-audit-2026-07-20.md`.

Each added redirect inventory row uses:

```text
redirect_id = gsc-audit-2026-07-20-<01..15>
configured_target = empty
hop_count = 1
known_state = verified-absent
required_action = create exact one-hop redirect
```

- [ ] **Step 1: Write failing builder tests**

In a temporary directory, invoke the exported builder and assert:

- exact source package hash and revision 5 are required;
- exactly 15 mappings are appended;
- each source and target is exact and unique;
- four unaffected semantic artifacts remain byte-identical;
- the redirect CSV changes only by the 15 appended rows;
- rules increase from 1,501 to 1,516 and coverage from 861 to 876;
- contract ambiguities remain zero;
- every new rule is resolved with no conditions/review gates;
- package review scope authorizes only these redirect mappings and keeps `liveExecutionAuthorized=false`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/gsc-redirect-amendment.test.mjs
```

Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement the self-validating builder**

Follow the existing content-addressed amendment pattern in `scripts/build-p0-topical-map-amendment.mjs`. Generate new CSV row fingerprints, semantic coverage/rule IDs, locator row numbers, source references, artifact hashes, contract hash, and canonical package hash. Abort on any source drift or non-allowlisted semantic difference.

- [ ] **Step 4: Run GREEN and generate**

```bash
node --test tests/gsc-redirect-amendment.test.mjs
node scripts/build-gsc-redirect-amendment.mjs
```

Expected: the test passes and the output reports 15 mappings, 1,516 rules, 876 coverage units, and zero ambiguities.

- [ ] **Step 5: Validate through Autopilot**

Run the existing package reader, compiler, contract-integrity, and validator against the generated root. Require six artifacts, exact hashes, valid status, and zero blocking issues.

---

### Task 5: Sitemap submission and governed SEO follow-ups

**Files:**

- Modify: `lib/connectors/gsc.ts`
- Create: `scripts/submit-gsc-sitemap.ts`
- Modify: `__tests__/lib/connectors/gsc.test.ts`
- Modify: `scripts/seed-seo-follow-up-tasks.ts`
- Modify: `__tests__/scripts/seed-seo-follow-up-tasks.test.ts`

**Interfaces:**

```ts
export async function submitGscSitemap(
  sitemapUrl: string,
): Promise<{ siteUrl: string; sitemapUrl: string; submitted: true }>;
```

The function uses the full `webmasters` scope only for the PUT submit call. Read-only GSC functions retain the readonly scope.

The follow-up seed retains the existing tasks and adds exact idempotent tasks for:

- red-rice vs brown-rice query/snippet review;
- black-rice vs red-rice canonical query/snippet review;
- pito-pito snippet and evidence review;
- turmeric dosage performance and medical-review evidence.

- [ ] **Step 1: Write failing sitemap tests**

Assert the URL-encoded domain property and sitemap URL, PUT method, empty body, write scope selection, bounded error, and success result.

- [ ] **Step 2: Run RED**

```bash
npm test -- __tests__/lib/connectors/gsc.test.ts
```

Expected: FAIL because `submitGscSitemap` is absent.

- [ ] **Step 3: Implement sitemap submission and dry-run command**

`scripts/submit-gsc-sitemap.ts` prints the target in dry-run mode. `--apply` performs the PUT and then lists submitted sitemaps for read-back. Unknown flags fail.

- [ ] **Step 4: Write failing SEO follow-up assertions**

Update the seed test to require the original three tasks plus the four new exact tasks, unique source keys, active-map URLs, GSC metrics/query mix evidence, and a medical-review requirement for turmeric.

- [ ] **Step 5: Run RED**

```bash
npm test -- __tests__/scripts/seed-seo-follow-up-tasks.test.ts
```

Expected: FAIL because only the original three tasks exist.

- [ ] **Step 6: Add the four idempotent follow-ups**

Do not create a title/metadata/content mutation. These are evidence-gathering tasks; the operator decides any future snippet change after the corrected non-overlapping baseline.

- [ ] **Step 7: Run GREEN**

```bash
npm test -- __tests__/lib/connectors/gsc.test.ts __tests__/scripts/seed-seo-follow-up-tasks.test.ts
```

Expected: PASS.

---

### Task 6: Full local verification and releases

**Files:**

- Modify only GROW/audit records after evidence exists.

- [ ] **Step 1: Run Autopilot verification**

```bash
npm run db:generate
npm run verify:prisma-client
npm test
npm run typecheck
npm run typecheck:test
npm run lint
npm run build
git diff --check
```

Require zero failures and no unrelated file ownership changes.

- [ ] **Step 2: Run theme verification**

```bash
node --test tests/schema-maximization-source.test.mjs tests/gsc-redirect-amendment.test.mjs
git diff --check
```

Require zero failures. Confirm the existing unrelated dirty theme files are unchanged by this run.

- [ ] **Step 3: Commit and push coherent changes**

Use isolated worktrees. Commit Autopilot and theme changes separately with intentional file lists. Do not include pre-existing `package.json`, security-header script, CSS, layout, article, robots, or annotation changes owned by another task.

- [ ] **Step 4: Deploy Autopilot**

Use `node scripts/git-deploy.mjs`. Require local/origin/server commit equality, current build artifact, online PM2, public health `ok`, and no migration drift.

- [ ] **Step 5: Stage and import the strategy package**

Copy exactly the manifest and six artifacts to a new mode-0700 production directory. Verify all artifact hashes and package identity. Update `TOPICAL_MAP_STRATEGY_ROOT`, restart, import through the authenticated `SETTINGS_ADMIN` route, and require lifecycle `validated`, validation `valid`, 1,516 rules, 876 coverage units, and zero issues.

- [ ] **Step 6: Activate the strategy revision**

Activate through the authenticated route with the operator identity and audit reason. Verify the sole active pointer references the new package and the prior version is superseded.

---

### Task 7: Approved live remediation

- [ ] **Step 1: Refresh corrected GSC windows**

Run the authenticated SEO refresh. Verify persisted current and previous windows are 28 inclusive calendar days, adjacent, and non-overlapping. Verify exact-window API aggregates equal the authenticated SEO Pilot cards and movers remain query-derived.

- [ ] **Step 2: Queue and approve the homepage schema recommendation**

Run the queue command without `--apply`, review exact theme/asset/before/after hashes, then apply queueing. Approve the exact Recommendation through the authenticated operator route with the GSC audit approval note.

- [ ] **Step 3: Execute and verify the homepage schema repair**

Execute only that recommendation with explicit live intent. Require Recommendation `executed`, exact Admin API asset read-back, rendered homepage JSON-LD without OfferCatalog/hasOfferCatalog, retained ItemList, and URL Inspection/rich-result recheck evidence. If Google has not recrawled yet, record the live fix and leave Google’s cached verdict pending.

- [ ] **Step 4: Synchronize, approve, and execute 15 redirect Store Tasks**

Run the authenticated topology sync. Require exactly 15 new `redirect_create` Store Tasks and linked pending Recommendations. For each task, verify source, target, active strategy identity, absent current redirect, and proposed hash; approve then execute through the exact Store Task endpoints. Require 15 completed tasks, 15 executed Recommendations, 15 minimal receipts, no locks, Admin API read-back, and HTTP one-hop read-back.

- [ ] **Step 5: Submit the root sitemap**

Run `scripts/submit-gsc-sitemap.ts --apply`. Require a successful API response and sitemap list read-back.

- [ ] **Step 6: Request priority indexing in the authenticated UI**

Use URL Inspection Request Indexing for `/pages/farming-practices`, `/collections/pure-powders`, `/pages/events`, and then the strongest governed recipe URLs until Google’s UI quota stops further requests. Record every accepted request and every unrequested URL. Do not claim indexing until later inspection passes.

- [ ] **Step 7: Apply governed SEO follow-up tasks**

Run the seed dry-run, then `--apply --production`. Require the original tasks to remain idempotent and the four approved GSC-07 follow-ups to be created exactly once. Do not mutate turmeric content.

- [ ] **Step 8: Verify and conditionally remove GSC-06**

Read the Merchant homepage resource and recheck its claim without overwrite. Inspect authenticated Google Workspace Admin domain verification/dependency state. If both are independent of the unused token, remove only that token in Search Console, then recheck Merchant claim and required owners. If Workspace access or dependency proof is unavailable, leave the token and record GSC-06 as intentionally pending.

---

### Task 8: Final evidence and GROW

- [ ] **Step 1: Re-audit authenticated surfaces**

Inspect Search Console, Autopilot SEO Pilot, Store Pilot, Recommendation records, rendered storefront schema, live redirects, sitemaps, URL Inspection, PM2, and public health. Trace every changed item to API and persisted evidence.

- [ ] **Step 2: Update the audit report**

Change each finding to one of:

- `verified_fixed`;
- `live_fixed_google_reprocessing_pending`;
- `governed_follow_up_created`;
- `pending_dependency_proof`;
- `blocked_by_google_quota`.

Include exact timestamps, IDs/hashes without secrets, and remaining open items.

- [ ] **Step 3: Run GROW in both repositories**

Update `.mex/ROUTER.md`, relevant context/pattern files, theme release annotations, planning metrics, and decision logs. Run `mex log` for strategy activation, live schema execution, redirects, and any GSC-06 decision.

- [ ] **Step 4: Run final fresh verification**

Repeat the full local test/typecheck/lint/build gates, theme source tests, production commit/build/PM2/health checks, and authenticated UI/API read-backs before making completion claims.
