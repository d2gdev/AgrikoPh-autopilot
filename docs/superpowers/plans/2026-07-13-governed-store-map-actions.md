# Governed Store Map Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn active-topical-map product, collection, and page work into reviewable Store Tasks that an operator can confirm and apply to Shopify, while unsupported theme work remains explicitly advisory.

**Architecture:** A focused Shopify resource adapter reads and mutates allowlisted fields. A topical-map task service projects exact active rules into deduplicated Store Tasks with current-state hashes and optional strictly validated AI copy. A separate authenticated apply route revalidates strategy, rule, resource state, permission, environment gate, and atomic claim before one Shopify mutation. Store Pilot renders the exact before/after state and makes confirmation the approval action.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/PostgreSQL, Shopify Admin GraphQL, Zod, Vitest, Shopify Polaris.

## Global Constraints

- Never execute live Shopify changes unless the exact linked Recommendation is `approved`/`override_approved` and `EXECUTE_APPROVED_LIVE_ENABLED=true`; route confirmation only approves and queues it.
- Every embedded route calls `await requireAppAuth(req)` as its first statement; Apply immediately requires `CONTENT_PUBLISH`, task synchronization requires `CONTENT_REVIEW`.
- All database access uses `import { prisma } from "@/lib/db"`; never instantiate `PrismaClient`.
- Reuse the existing Recommendation lifecycle, `StoreTask`, `execute-approved`, and `shopifyFetch`; the only schema addition is a narrow persisted normalized-target execution lock.
- Freeze the strict proposed-state hash at approval. Never synchronize over approved/override-approved/executing bytes, and compare the frozen hash before executor claim or Shopify access.
- Finalize Store Task, Recommendation, both audits, minimal receipt, and lock release atomically. Interrupted or uncertain execution remains visible and is reobserved by stale recovery.
- Product and collection writes are limited to `seo` and `descriptionHtml`; page writes are limited to `title`, `body`, and `global.title_tag` / `global.description_tag` metafields.
- Handles, publication state, price, product status, navigation, theme templates, redirects, canonicalization, and indexation are never executed by this feature.
- Homepage and blog-index work is advisory-only. Blog articles remain exclusively in Content Pilot.
- Every executable task retains the exact active strategy version ID, package SHA-256, rule IDs, normalized target URL, observation timestamp, and current-state hash.
- AI output is optional drafting only, uses the existing failover client, and must pass strict Zod field and length validation; invalid output creates no guessed executable change.
- No analysis, synchronization, GET, or background request performs a Shopify mutation.

---

### Task 1: Shopify governed-resource adapter

**Files:**
- Create: `lib/shopify-governed-resources.ts`
- Modify: `lib/shopify-admin.ts`
- Test: `__tests__/lib/shopify-governed-resources.test.ts`
- Test: `__tests__/lib/shopify-admin.test.ts`

**Interfaces:**
- Produces `GovernedStoreTargetType = "product" | "collection" | "page"`.
- Produces `GovernedStoreResource` with `id`, `type`, `url`, `handle`, `title`, `seoTitle`, `seoDescription`, `bodyHtml`, `updatedAt`, `stateHash`, and `internalTargets`.
- Produces `fetchGovernedStoreResources(urls: string[]): Promise<Map<string, GovernedStoreResource>>`.
- Produces `fetchGovernedStoreResource(url: string): Promise<GovernedStoreResource | null>`.
- Produces `applyGovernedStoreResourceChange(resource, proposed): Promise<GovernedStoreResource>` where `proposed` contains only `seoTitle`, `seoDescription`, `title`, or `bodyHtml`.

- [ ] **Step 1: Write failing adapter tests**

Add tests that mock `shopifyFetch` and prove:

```ts
expect(resolveGovernedStoreUrl("/products/pure-ginger")).toEqual({ type: "product", handle: "pure-ginger" });
expect(resolveGovernedStoreUrl("/collections/turmeric")).toEqual({ type: "collection", handle: "turmeric" });
expect(resolveGovernedStoreUrl("/pages/about")).toEqual({ type: "page", handle: "about" });
expect(resolveGovernedStoreUrl("/")).toBeNull();
expect(resolveGovernedStoreUrl("/blogs/news")).toBeNull();
```

Mock one resource of each type and assert URL normalization, SEO metafield extraction for pages, normalized internal targets, stable SHA-256 state hashing, missing handle omission, and pagination. Assert a changed title/body/SEO value changes the hash.

- [ ] **Step 2: Verify the tests fail for missing interfaces**

Run: `npx vitest run __tests__/lib/shopify-governed-resources.test.ts`

Expected: FAIL because `lib/shopify-governed-resources.ts` does not exist.

- [ ] **Step 3: Implement read-only resource observation**

Use `shopifyFetch` for paginated `products`, `collections`, and `pages` queries. Select only the fields required by `GovernedStoreResource`. Parse body links through `parseArticleHtml` and `normalizeGovernedUrl`. Hash this exact canonical JSON shape:

```ts
JSON.stringify({ id, type, url, title, seoTitle, seoDescription, bodyHtml, updatedAt: updatedAt.toISOString() })
```

Reject URL forms outside `/products/:handle`, `/collections/:handle`, and `/pages/:handle`. Return maps keyed by normalized governed URL.

- [ ] **Step 4: Write failing mutation tests**

Assert exact Shopify GraphQL variables for:

```ts
{ type: "product", proposed: { seoTitle: "Pure Ginger | Agriko", seoDescription: "...", bodyHtml: "<p>...</p>" } }
{ type: "collection", proposed: { seoTitle: "Organic Rice | Agriko", bodyHtml: "<p>...</p>" } }
{ type: "page", proposed: { title: "About Agriko", seoTitle: "About Agriko", seoDescription: "...", bodyHtml: "<p>...</p>" } }
```

Assert allowlist rejection for `handle`, `status`, `published`, `price`, and unknown keys; Shopify `userErrors`; missing returned objects; and post-mutation refetch.

- [ ] **Step 5: Implement focused mutation functions**

Add `updateCollectionSeoAndBody` and `updatePageSeoAndBody` beside `updateProductSeo`. Extend product updating to accept `descriptionHtml` without changing existing callers. Page SEO uses metafields with namespace `global`, keys `title_tag` and `description_tag`, and type `single_line_text_field`. Validate title <= 70 characters, description <= 160 characters, and HTML <= 50,000 characters before transport.

- [ ] **Step 6: Verify Task 1**

Run: `npx vitest run __tests__/lib/shopify-governed-resources.test.ts __tests__/lib/shopify-admin.test.ts`

Expected: all tests pass and no Shopify request occurs outside mocks.

- [ ] **Step 7: Commit Task 1**

```bash
git add lib/shopify-governed-resources.ts lib/shopify-admin.ts __tests__/lib/shopify-governed-resources.test.ts __tests__/lib/shopify-admin.test.ts
git commit -m "feat(store): add governed Shopify resource adapter"
```

---

### Task 2: Topical-map Store Task synchronization

**Files:**
- Create: `lib/store-tasks/topical-map.ts`
- Test: `__tests__/lib/store-tasks/topical-map.test.ts`

**Interfaces:**
- Consumes `loadActiveTopicalMapCommandCenter`, `fetchGovernedStoreResources`, `chatCompletionWithFailover`, and a Prisma-compatible client.
- Produces `syncTopicalMapStoreTasks(client, options?): Promise<{ executable: number; advisory: number; unchanged: number; suppressed: number }>`.
- Produces strict exported `TopicalMapStoreTaskSourceSchema` and `TopicalMapStoreTaskProposedSchema` for the apply boundary.

- [ ] **Step 1: Write failing projection and dedupe tests**

Cover:

- non-blog product, collection, and page content decisions;
- non-blog internal-link rules;
- exclusion of blog articles;
- homepage and blog indexes as advisory tasks;
- redirect/canonical/indexation rules excluded from executable tasks;
- missing resource observations suppressed rather than executable;
- exact strategy/rule/source identity in `sourceData`;
- exact current/proposed values in `proposedState`;
- stable deterministic dedupe key based on strategy identity, sorted rule IDs, normalized URL, and action type, with the proposed hash stored separately;
- pending task upsert, with completed/dismissed history never silently reopened.

- [ ] **Step 2: Verify projection tests fail**

Run: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts`

Expected: FAIL because the synchronization service does not exist.

- [ ] **Step 3: Implement strict task schemas and deterministic projections**

Use these executable action types:

```ts
type TopicalMapStoreAction = "seo_update" | "content_update" | "internal_link";
```

Store executable task data as:

```ts
sourceData: {
  source: "topical-map";
  strategyVersionId: string;
  packageSha256: string;
  ruleIds: string[];
  ruleDomains: string[];
  targetType: "product" | "collection" | "page";
  targetUrl: string;
  observedAt: string;
  observedStateHash: string;
  executable: true;
}
proposedState: {
  action: "seo_update" | "content_update" | "internal_link";
  before: { title?: string; seoTitle?: string | null; seoDescription?: string | null; bodyHtml?: string };
  after: { title?: string; seoTitle?: string; seoDescription?: string; bodyHtml?: string };
}
```

Advisory tasks use `executable: false` and an `advisoryReason`; they never contain an executable after-state.

- [ ] **Step 4: Write failing AI-draft tests**

Mock one batched AI response and assert strict parsing, 70/160 character bounds, rejection of invented handles/publication fields, grounding in the map theme/current resource, and fallback to advisory when output is invalid or unavailable. Internal-link `bodyHtml` is deterministic: append one sanitized paragraph only when the exact normalized destination is absent, using the rule's recommended anchor.

- [ ] **Step 5: Implement balanced drafting and upsert**

Make at most one AI call per synchronization. Ask only for entries needing SEO/content copy, keyed by normalized URL. Validate with Zod and merge only allowlisted fields. Do not replace existing body wholesale: for content updates, preserve current HTML and append a bounded generated section; for internal links, append a bounded paragraph. Upsert only pending/failed tasks sharing the deterministic dedupe key; preserve completed/dismissed tasks and return them as unchanged.

- [ ] **Step 6: Verify Task 2**

Run: `npx vitest run __tests__/lib/store-tasks/topical-map.test.ts`

Expected: all tests pass, including AI failure and exact provenance cases.

- [ ] **Step 7: Commit Task 2**

```bash
git add lib/store-tasks/topical-map.ts __tests__/lib/store-tasks/topical-map.test.ts
git commit -m "feat(store): synchronize topical-map tasks"
```

---

### Task 3: Authenticated synchronization, Recommendation approval, and guarded executor dispatch

**Files:**
- Create: `app/api/store-tasks/topical-map/sync/route.ts`
- Create: `app/api/store-tasks/[id]/apply/route.ts`
- Create: `lib/store-tasks/apply-topical-map.ts`
- Modify: `app/api/store-tasks/route.ts`
- Test: `__tests__/api/topical-map-store-tasks.test.ts`
- Test: `__tests__/lib/store-tasks/apply-topical-map.test.ts`

**Interfaces:**
- Sync route returns `{ executable, advisory, unchanged, suppressed }`.
- Apply service returns `{ task, receipt }` or typed conflicts `LIVE_DISABLED`, `TASK_NOT_PENDING`, `TASK_NOT_EXECUTABLE`, `STRATEGY_CHANGED`, `RULE_CHANGED`, `OBSERVATION_CHANGED`, `SHOPIFY_FAILED`.
- Apply route returns 202 for queued approval and never mutates Shopify; executor dispatch records verified completion or a safe failed/uncertain state.
- List and detail APIs use explicit bounded Zod DTOs. Applying, reconciliation-needed, and failed states remain visible; retry is only a fresh synchronization/reobservation.

- [ ] **Step 1: Write failing auth and sync route tests**

Assert `requireAppAuth` is first, `CONTENT_REVIEW` is checked before synchronization, and no Prisma/Shopify/AI call occurs on denial. Assert the service result is returned unchanged and errors use safe messages.

- [ ] **Step 2: Implement the sync route**

Follow the embedded route pattern exactly. Add rate limiting keyed by actor to five synchronizations per minute. The route only observes Shopify and upserts Store Tasks; it never calls a mutation function.

- [ ] **Step 3: Write failing apply-service tests**

Cover all gates in this order:

1. `EXECUTE_APPROVED_LIVE_ENABLED === "true"`;
2. task exists, is `pending`, and parses as executable topical-map data;
3. active strategy identity matches;
4. exact active projected rule IDs still govern the same target/action;
5. current Shopify resource exists and its state hash matches;
6. atomic `updateMany({ where: { id, status: "pending" }, data: { status: "applying", reviewedBy, reviewedAt } })` claims exactly one row;
7. one allowlisted mutation runs;
8. returned Shopify state matches every proposed field;
9. task becomes `completed` and an audit row stores safe before/after plus strategy/rule receipt.

Also assert duplicate claims, changed objects, changed rules, unsupported targets, Shopify user errors, and returned-state mismatches never report completion. A claimed task that fails becomes `failed` with a safe completion note and an audit failure entry.

- [ ] **Step 4: Implement the apply service**

Keep orchestration in `lib/store-tasks/apply-topical-map.ts`; the route must not contain mutation logic. Reuse the exported schemas from Task 2 and the adapter from Task 1. Use Prisma transactions for claims and terminal DB/audit writes, but never hold a database transaction open across the Shopify network call.

- [ ] **Step 5: Write and implement apply-route tests**

The route must call `await requireAppAuth(req)` first and immediately require `CONTENT_PUBLISH`. Parse only the route parameter; proposed state always comes from the database, never the client. Map typed service errors to safe status codes without source bytes or credentials.

- [ ] **Step 6: Preserve ordinary Store Task behavior**

Update `app/api/store-tasks/route.ts` so topical-map executable tasks cannot be manually marked `completed` through the legacy PATCH route. They may still be dismissed. Existing non-map tasks retain the current completion behavior.

- [ ] **Step 7: Verify Task 3**

Run: `npx vitest run __tests__/api/topical-map-store-tasks.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/api/store-tasks-route.test.ts`

Expected: all tests pass with zero unconfirmed mutation calls.

- [ ] **Step 8: Commit Task 3**

```bash
git add app/api/store-tasks/topical-map/sync/route.ts app/api/store-tasks/[id]/apply/route.ts app/api/store-tasks/route.ts lib/store-tasks/apply-topical-map.ts __tests__/api/topical-map-store-tasks.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/api/store-tasks-route.test.ts
git commit -m "feat(store): apply confirmed topical-map tasks"
```

---

### Task 4: Store Pilot operator workflow

**Files:**
- Modify: `app/(embedded)/(store-pilot)/store-pilot/page.tsx`
- Create: `app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails.tsx`
- Create: `app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx`
- Test: `__tests__/components/store-pilot-map-actions.test.tsx`
- Test: `__tests__/components/store-pilot-source.test.ts`

**Interfaces:**
- Consumes current Store Task GET data plus sync/apply endpoints.
- `MapTaskDetails` renders capability, active identity summary, rules, evidence time, target, and before/after fields.
- `ApplyMapTaskModal` receives the selected task and invokes a supplied confirmed callback; it never constructs proposed state.

- [ ] **Step 1: Write failing source and component tests**

Assert:

- a `Sync topical map` control calls the sync endpoint then reloads task buckets;
- topical-map rows have `Executable` or `Advisory only` labels;
- exact before/after fields are visible without raw JSON;
- executable pending tasks show Apply and Dismiss, not legacy Complete;
- advisory tasks show Dismiss only and their reason;
- Apply opens a modal naming the target and changed fields;
- only modal confirmation calls `/api/store-tasks/:id/apply`;
- success reloads buckets and shows a toast;
- 403, 409, and 502 responses remain visible with useful messages;
- non-map Store Tasks keep their existing Complete/Dismiss controls.

- [ ] **Step 2: Verify UI tests fail**

Run: `npx vitest run __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts`

Expected: FAIL because the map components and controls do not exist.

- [ ] **Step 3: Implement focused components**

Extract only map-specific details and confirmation modal. Keep task loading and ordinary task behavior in the existing page. Use Polaris components and existing tones; do not redesign the image dashboard or navigation.

- [ ] **Step 4: Implement sync/apply state and feedback**

Add separate loading IDs for sync and Apply, a success Toast, and persistent error Banner. After success, reload all status buckets. Disable duplicate actions while a request is active. Keep Shopify context URLs through the existing authenticated fetch hook.

- [ ] **Step 5: Verify Task 4**

Run: `npx vitest run __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add 'app/(embedded)/(store-pilot)/store-pilot/page.tsx' 'app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails.tsx' 'app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx' __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts
git commit -m "feat(store): add topical-map apply workflow"
```

---

### Task 5: Integration, GROW, and release verification

**Files:**
- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/architecture.md`
- Modify: `.mex/patterns/strategy-bound-seo-command-center.md`
- Modify: `.mex/patterns/pilot-queue-usability.md`
- Modify if required by integration: `app/api/seo/analyze/route.ts`
- Test: `__tests__/api/seo-pilot-routes.test.ts`

**Interfaces:**
- SEO analysis may invoke `syncTopicalMapStoreTasks` only after successfully persisting the exact active-map analysis; a synchronization failure is reported separately and must not corrupt or erase the analysis snapshot.
- Analysis response adds bounded `storeTaskSync` counts and no task source bytes.

- [ ] **Step 1: Write failing integration test**

Assert one operator-triggered SEO analysis refresh persists its snapshot, synchronizes non-blog Store Tasks, returns bounded counts, performs zero Shopify mutations, and preserves the existing 92 blog gap behavior. Assert sync failure leaves analysis available and returns a safe partial sync status.

- [ ] **Step 2: Implement analysis integration**

Call the synchronization service after analysis persistence. Do not make task synchronization a prerequisite for the analysis GET ready-state. Keep the standalone Store Pilot sync endpoint for operator retry.

- [ ] **Step 3: Run focused release gate**

Run:

```bash
npx vitest run __tests__/lib/shopify-governed-resources.test.ts __tests__/lib/shopify-admin.test.ts __tests__/lib/store-tasks/topical-map.test.ts __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/api/topical-map-store-tasks.test.ts __tests__/api/store-tasks-route.test.ts __tests__/api/seo-pilot-routes.test.ts __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
npm run lint
git diff --check
DATABASE_URL='postgresql://test:test@127.0.0.1:5432/autopilot_test?connection_limit=10&pool_timeout=10' npm run build
```

Expected: tests and build exit 0, lint has zero errors, and diff check is clean.

- [ ] **Step 5: Run GROW**

Record the exact supported mutations, confirmed-Apply boundary, strategy/state revalidation, advisory-only targets, test counts, and absence of autonomous execution. Update pattern gotchas so future work does not route blog articles to Store Tasks or mark executable map tasks complete without a Shopify receipt. Bump every changed scaffold `last_updated` value.

- [ ] **Step 6: Commit Task 5**

```bash
git add .mex/ROUTER.md .mex/context/architecture.md .mex/patterns/strategy-bound-seo-command-center.md .mex/patterns/pilot-queue-usability.md app/api/seo/analyze/route.ts __tests__/api/seo-pilot-routes.test.ts
git commit -m "docs(store): record governed map execution"
```

- [ ] **Step 7: Whole-branch review and deployment gate**

Run the required whole-branch code review. Fix every Critical or Important finding and rerun covering tests. Only after a clean review, push `main`, deploy with `node scripts/git-deploy.mjs`, and verify matching local/origin/server commit, active build time after commit, PM2 online after the build, and public health `ok`.

- [ ] **Step 8: Production acceptance without an unapproved write**

Run authenticated synchronization and verify executable/advisory counts, exact active strategy identity, and zero recommendation/proposal mutation. Confirm the Store Pilot bundle contains the review and Apply flow. Do not select or apply a production task during deployment. The first live task remains pending until the operator reviews its actual before/after values and confirms Apply in Shopify Admin.
