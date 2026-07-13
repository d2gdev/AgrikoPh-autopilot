# Topical-Map Integration Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make topical-map Store Tasks truthful, usable, individually executable, diagnosable, and measurable without expanding existing Shopify write authority.

**Architecture:** Keep the current `StoreTask` → linked `Recommendation` → `execute-approved` lifecycle. Extend it in place with stable advisory identity, a truthful paginated query contract, a target-specific executor option, typed terminal-state handling, and one URL-level GSC evaluator; add no persistence model, queue framework, or autonomous behavior.

**Tech Stack:** Next.js 15 App Router, React 18, Shopify Polaris 13, TypeScript 5.6, Prisma 6/PostgreSQL, Zod 3, Vitest 4, Google Search Console Search Analytics API.

## Global Constraints

- Preserve `StoreTask`, `Recommendation`, `execute-approved`, and the current topical-map strategy boundaries.
- Live Shopify writes still require `EXECUTE_APPROVED_LIVE_ENABLED=true` and recommendation status `approved` or `override_approved`.
- Preserve proposed-state hashing, active-strategy and rule checks, Shopify before-state validation, target locks, verified receipts, and reobservation.
- Keep redirects, canonicalization, indexation, homepage, blog-index, and unavailable drafts advisory-only.
- Do not add autonomous approval or execution, a workflow engine, an event bus, a generic queue framework, a new frontend application, or an unrelated visual redesign.
- Every embedded route must call `await requireAppAuth(req)` first; publish mutations must then call `await requirePermission(req, PERMISSIONS.CONTENT_PUBLISH)` before parsing or persistence.
- All database access must use `import { prisma } from "@/lib/db"`; never instantiate `PrismaClient`.
- Never persist secrets, tokens, GraphQL variables, complete HTML bodies, raw database errors, or source strategy bytes in diagnostics.
- Production deployment, production cleanup writes, strategy activation, and live Shopify execution require separate authority; this implementation plan grants local code, test, documentation, and commit work only.

---

## File Structure

**Create:**

- `lib/store-tasks/topical-map-advisories.ts` — stable advisory identity, pure duplicate grouping, and the shared transactional cleanup operation.
- `scripts/cleanup-topical-map-advisories.ts` — dry-run-by-default command that invokes the shared cleanup operation; `--apply` enables dismissals.
- `app/api/store-tasks/[id]/execute/route.ts` — authenticated operator endpoint that dispatches only the recommendation linked to one Store Task.
- `__tests__/api/store-task-execute-route.test.ts` — auth, linkage, live-gate delegation, and bounded-response tests for that endpoint.
- `lib/recommendations/topical-map-outcome.ts` — pure date-window, metric, delta, and verdict functions for URL-level GSC outcomes.
- `__tests__/lib/recommendations/topical-map-outcome.test.ts` — deterministic outcome evaluator tests.
- `__tests__/lib/connectors/gsc.test.ts` — exact page-filtered Search Analytics request and response-boundary tests.

**Modify:**

- `lib/store-tasks/topical-map.ts` — use semantic advisory keys and supersede obsolete equivalent advisories during sync.
- `__tests__/lib/store-tasks/topical-map.test.ts` — sync identity and supersession regressions.
- `package.json` — add the explicit cleanup command.
- `app/api/store-tasks/route.ts` — bounded pagination, execution-class and search filters, accurate database totals.
- `__tests__/api/store-tasks-route.test.ts` — query validation, count parity, pagination, and auth-first tests.
- `app/(embedded)/(store-pilot)/store-pilot/page.tsx` — actionable/advisory queue views, search, status, page controls, accurate summary counts, and two-stage execution flow.
- `app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails.tsx` — semantic grouped-link review with raw HTML behind disclosure.
- `app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx` — separate approval and execution actions with accurate copy.
- `__tests__/components/store-pilot-map-actions.test.tsx` — queue controls and approval/execution behavior.
- `__tests__/components/store-pilot-source.test.ts` — source-level regression for the two queue views and removed all-status preload.
- `jobs/execute-approved.ts` — optional exact recommendation selection, superseded classification, counters, and awaited audits.
- `__tests__/jobs/execute-approved.test.ts` — scheduled batch behavior remains unchanged.
- `__tests__/jobs/execute-approved-store-task.test.ts` — exact selection, stale classification, diagnostics, and audit durability.
- `lib/store-tasks/apply-topical-map.ts` — safe typed execution diagnostics and post-error reobservation.
- `__tests__/lib/store-tasks/apply-topical-map.test.ts` — typed diagnostics without sensitive payloads.
- `lib/connectors/gsc.ts` — one bounded page-filtered aggregate query for an exact date window.
- `jobs/check-outcomes.ts` — route topical-map executions to the URL evaluator while leaving other platforms unchanged.
- `__tests__/jobs/check-outcomes.test.ts` — exact before/after URL windows, lag deferral, and typed insufficient-data results.
- `.mex/ROUTER.md` — record the completed remediation after verification.
- `.mex/context/architecture.md` — update the Store Task execution and outcome flow after it exists.

No Prisma schema or migration changes are required.

---

### Task 1: Stable Advisory Identity and Idempotent Cleanup

**Files:**

- Create: `lib/store-tasks/topical-map-advisories.ts`
- Create: `scripts/cleanup-topical-map-advisories.ts`
- Modify: `lib/store-tasks/topical-map.ts`
- Modify: `__tests__/lib/store-tasks/topical-map.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: parsed advisory `sourceData` fields from `TopicalMapStoreTaskSourceSchema`.
- Produces:

```ts
export type AdvisorySemanticIdentity = {
  strategyVersionId: string;
  packageSha256: string;
  targetUrl: string;
  advisoryReason: string;
  ruleIds: string[];
};

export function topicalMapAdvisorySemanticKey(input: AdvisorySemanticIdentity): string;

export type AdvisoryDuplicateRow = {
  id: string;
  createdAt: Date;
  status: string;
  sourceData: unknown;
};

export type AdvisoryDuplicateGroup = {
  semanticKey: string;
  keepId: string;
  dismissIds: string[];
};

export function selectAdvisoryDuplicateGroups(rows: AdvisoryDuplicateRow[]): AdvisoryDuplicateGroup[];

export async function cleanupTopicalMapAdvisories(
  db: Pick<typeof prisma, "storeTask" | "recommendation" | "auditLog" | "$transaction">,
  options: { apply: boolean; actor: string },
): Promise<{ groups: number; kept: number; duplicates: number; dismissed: number; rejectedRecommendations: number }>;
```

- The same semantic-key function is used by normal sync and the one-time cleanup command.

- [ ] **Step 1: Write failing pure identity and duplicate-selection tests**

Add cases to `__tests__/lib/store-tasks/topical-map.test.ts` proving rule order does not change identity, advisory reason does change identity, the newest valid pending row is retained, and completed/dismissed rows are never cleanup candidates.

```ts
it("uses one semantic identity regardless of rule order", () => {
  expect(topicalMapAdvisorySemanticKey({ ...identity, ruleIds: ["r2", "r1", "r1"] }))
    .toBe(topicalMapAdvisorySemanticKey({ ...identity, ruleIds: ["r1", "r2"] }));
});

it("keeps the newest pending advisory and dismisses only older pending or failed duplicates", () => {
  expect(selectAdvisoryDuplicateGroups(rows)).toEqual([{
    semanticKey: expect.any(String),
    keepId: "newest-pending",
    dismissIds: ["older-failed", "older-pending"],
  }]);
});
```

- [ ] **Step 2: Run the focused test and verify the new exports are absent**

Run: `npm test -- __tests__/lib/store-tasks/topical-map.test.ts`

Expected: FAIL because `topicalMapAdvisorySemanticKey` and `selectAdvisoryDuplicateGroups` do not exist.

- [ ] **Step 3: Implement the stable pure identity and duplicate grouping**

Create `lib/store-tasks/topical-map-advisories.ts` with deterministic normalization:

```ts
function canonicalIdentity(input: AdvisorySemanticIdentity) {
  return JSON.stringify({
    strategyVersionId: input.strategyVersionId,
    packageSha256: input.packageSha256.toLowerCase(),
    targetUrl: normalizeGovernedUrl(input.targetUrl),
    advisoryReason: input.advisoryReason,
    ruleIds: [...new Set(input.ruleIds)].sort(),
  });
}

export function topicalMapAdvisorySemanticKey(input: AdvisorySemanticIdentity): string {
  return createHash("sha256").update(canonicalIdentity(input)).digest("hex");
}
```

Parse only `source === "topical-map"`, `executable === false` rows. Group only `pending` and `failed` rows. Within each group, retain the newest `pending` row when one exists; only fall back to the newest `failed` row when the group has no pending row. Break equal timestamps by `id` ascending and return sorted `dismissIds` for every group with more than one candidate. This keeps an actionable reference pending instead of allowing a newer failed duplicate to hide it.

- [ ] **Step 4: Use semantic advisory identity in normal synchronization**

In `lib/store-tasks/topical-map.ts`, replace the advisory branch of the current versioned hash input with:

```ts
const identity = topicalMapAdvisorySemanticKey({
  strategyVersionId: center.identity.versionId,
  packageSha256: center.identity.packageSha256,
  targetUrl: task.targetUrl,
  advisoryReason: task.sourceData.advisoryReason,
  ruleIds: task.ruleIds,
});
const dedupeKey = `store-task:topical-map:advisory:${identity}`;
```

After upserting the retained advisory, call a focused `supersedeEquivalentAdvisories(...)` function in `topical-map-advisories.ts`. It must:

```ts
await db.$transaction(async (tx) => {
  const updated = await tx.storeTask.updateMany({
    where: { id: { in: dismissIds }, status: { in: ["pending", "failed"] } },
    data: {
      status: "dismissed",
      completedAt: now,
      completionNote: `Superseded by topical-map advisory ${keepId}`,
    },
  });
  if (updated.count !== dismissIds.length) throw new Error("Advisory cleanup lost a concurrent update");
  await tx.recommendation.updateMany({
    where: {
      targetEntityId: { in: dismissIds },
      platform: "shopify",
      actionType: "apply_topical_map_store_task",
      status: { in: ["pending", "failed"] },
    },
    data: {
      status: "rejected",
      reviewedBy: actor,
      reviewedAt: now,
      reviewNote: `Superseded by topical-map advisory ${keepId}`,
    },
  });
  for (const id of dismissIds) {
    await tx.auditLog.create({
      data: {
        actor,
        action: "topical_map_advisory_superseded",
        entityType: "StoreTask",
        entityId: id,
        after: { status: "dismissed", replacementTaskId: keepId, semanticKey },
      },
    });
  }
});
```

Do not alter approved, override-approved, executing, completed, already dismissed, or receipt-bearing work.

- [ ] **Step 5: Add sync regressions for old-key supersession and idempotency**

Mock one old pending advisory with a different historical `dedupeKey` but identical semantic fields. Assert the first sync dismisses it and audits the replacement; the second sync changes no additional row and reports the retained advisory as unchanged.

```ts
expect(client.storeTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ status: { in: ["pending", "failed"] } }),
  data: expect.objectContaining({ status: "dismissed" }),
}));
```

- [ ] **Step 6: Implement the dry-run-by-default cleanup operation and command**

`cleanupTopicalMapAdvisories` reads only topical-map advisory rows in `pending` or `failed`, computes groups with the pure selector, and returns counts without writes when `apply` is false. With `apply: true`, process one semantic group per transaction and use the same dismissal/rejection/audit operation as sync.

Create `scripts/cleanup-topical-map-advisories.ts`:

```ts
import { prisma } from "@/lib/db";
import { cleanupTopicalMapAdvisories } from "@/lib/store-tasks/topical-map-advisories";

const apply = process.argv.includes("--apply");
const result = await cleanupTopicalMapAdvisories(prisma, {
  apply,
  actor: "topical-map-advisory-cleanup",
});
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
await prisma.$disconnect();
```

Add:

```json
"store-tasks:cleanup-topical-map-advisories": "tsx scripts/cleanup-topical-map-advisories.ts"
```

The command must exit nonzero on a transaction or audit failure. It must never delete a task, recommendation, receipt, source record, or audit.

- [ ] **Step 7: Verify Task 1**

Run:

```bash
npm test -- __tests__/lib/store-tasks/topical-map.test.ts
npm run typecheck
git diff --check
```

Expected: focused tests PASS, typecheck exits 0, and diff check prints nothing.

- [ ] **Step 8: Commit Task 1**

```bash
git add lib/store-tasks/topical-map-advisories.ts lib/store-tasks/topical-map.ts scripts/cleanup-topical-map-advisories.ts __tests__/lib/store-tasks/topical-map.test.ts package.json
git commit -m "fix(store): deduplicate topical map advisories"
```

---

### Task 2: Truthful Bounded Store Task Query

**Files:**

- Modify: `app/api/store-tasks/route.ts`
- Modify: `__tests__/api/store-tasks-route.test.ts`

**Interfaces:**

- Consumes query parameters `status`, `executionClass`, `q`, `page`, and `pageSize`.
- Produces:

```ts
type StoreTaskPage = {
  tasks: StoreTaskListDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};
```

- `executionClass=actionable` means every task except a topical-map task whose source explicitly says `executable: false`; `executionClass=advisory` means only those non-executable topical-map tasks.

- [ ] **Step 1: Expand the route mock and write failing pagination/filter tests**

Extend the hoisted `storeTask` mock with `findMany` and `count`. Add tests for:

```ts
it.each(["page=0", "page=x", "pageSize=0", "pageSize=101", "executionClass=unknown"])(
  "rejects invalid query %s before Prisma",
  async (query) => { /* assert 400 and neither count nor findMany called */ },
);

it("uses the same where clause for count and page data", async () => {
  // request status=pending&executionClass=advisory&q=canonical&page=2&pageSize=50
  expect(db.storeTask.count).toHaveBeenCalledWith({ where: expectedWhere });
  expect(db.storeTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expectedWhere,
    skip: 50,
    take: 50,
  }));
});
```

Also assert `total` comes from `count`, not the returned array length, and `hasMore` is `page * pageSize < total`.

- [ ] **Step 2: Run the route test and verify it fails on the old contract**

Run: `npm test -- __tests__/api/store-tasks-route.test.ts`

Expected: FAIL because the GET route does not call `count` or validate pagination/execution class.

- [ ] **Step 3: Implement strict query parsing after the auth gate**

Keep `await requireAppAuth(req)` as the first statement. Parse with these exact bounds:

```ts
const page = Number(searchParams.get("page") ?? "1");
const pageSize = Number(searchParams.get("pageSize") ?? "50");
const executionClass = searchParams.get("executionClass") ?? "actionable";
const q = (searchParams.get("q") ?? "").trim().slice(0, 200);

if (!Number.isInteger(page) || page < 1 ||
    !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
    !["actionable", "advisory"].includes(executionClass)) {
  return NextResponse.json({ error: "Invalid Store Task query." }, { status: 400 });
}
```

Continue validating `status` against the existing whitelist.

- [ ] **Step 4: Build one Prisma `where` and reuse it for count and page reads**

Use one `Prisma.StoreTaskWhereInput`. The advisory predicate is:

```ts
const advisoryWhere: Prisma.StoreTaskWhereInput = {
  AND: [
    { sourceData: { path: ["source"], equals: "topical-map" } },
    { sourceData: { path: ["executable"], equals: false } },
  ],
};
```

For actionable, use `NOT: advisoryWhere`; for advisory, spread `advisoryWhere`. Add a case-insensitive `OR` across `title`, `targetUrl`, and `description` only when `q` is nonempty. Then:

```ts
const [total, tasks] = await Promise.all([
  prisma.storeTask.count({ where }),
  prisma.storeTask.findMany({
    where,
    select: STORE_TASK_LIST_SELECT,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  }),
]);
```

Map every row with `toStoreTaskListDto`. If a persisted row violates the DTO boundary, return a safe `500` and log only its ID; do not silently drop it and make the page count dishonest.

- [ ] **Step 5: Verify auth-first, DTO bounds, and the complete response**

Add assertions that an auth failure prevents query parsing and Prisma access, malformed data produces a JSON `500`, and a successful response exactly contains:

```ts
{
  tasks: expect.any(Array),
  total: 704,
  page: 2,
  pageSize: 50,
  hasMore: true,
}
```

- [ ] **Step 6: Verify Task 2**

Run:

```bash
npm test -- __tests__/api/store-tasks-route.test.ts __tests__/lib/store-tasks/dto.test.ts
npm run typecheck
git diff --check
```

Expected: both test files PASS, typecheck exits 0, diff check is clean.

- [ ] **Step 7: Commit Task 2**

```bash
git add app/api/store-tasks/route.ts __tests__/api/store-tasks-route.test.ts
git commit -m "fix(store): paginate topical map task inventory"
```

---

### Task 3: Actionable Queue UX and Semantic Link Review

**Files:**

- Modify: `app/(embedded)/(store-pilot)/store-pilot/page.tsx`
- Modify: `app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails.tsx`
- Modify: `app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx`
- Modify: `__tests__/components/store-pilot-map-actions.test.tsx`
- Modify: `__tests__/components/store-pilot-source.test.ts`

**Interfaces:**

- Consumes the `StoreTaskPage` contract from Task 2.
- Produces two primary queue views (`actionable`, `advisory`), one secondary status filter, query search, page navigation, and semantic internal-link review.
- Approval remains a distinct stage; Task 4 wires the second execution request.

- [ ] **Step 1: Write failing component/source regressions for the revised information architecture**

Add tests that assert:

```ts
expect(screen.getByRole("tab", { name: "Actionable" })).toBeVisible();
expect(screen.getByRole("tab", { name: "Advisory" })).toBeVisible();
expect(screen.getByRole("searchbox", { name: "Search Store Tasks" })).toBeVisible();
expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
```

Render a grouped internal-link task with two `sourceData.links` entries and assert both anchor texts and destination URLs appear before any raw HTML. The source test must prove `TASK_TABS.map(...fetch...)` and the six-status preload are absent.

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run:

```bash
npm test -- __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts
```

Expected: FAIL because the current page has status-only tabs, preloads every status, and exposes before/after HTML as its main internal-link review.

- [ ] **Step 3: Replace all-status buckets with one server-paginated queue state**

In `page.tsx`, define:

```ts
type ExecutionClass = "actionable" | "advisory";
const PAGE_SIZE = 50;

const [executionClass, setExecutionClass] = useState<ExecutionClass>("actionable");
const [status, setStatus] = useState<StoreTask["status"]>("pending");
const [search, setSearch] = useState("");
const [page, setPage] = useState(1);
const [taskPage, setTaskPage] = useState<StoreTaskPage>({
  tasks: [], total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false,
});
```

Load only the selected page URL with `URLSearchParams`. Reset `page` to `1` when execution class, status, or the submitted search changes. Keep the existing mutation lock so sync, approve, execute, complete, and dismiss cannot overlap in the browser.

- [ ] **Step 4: Load accurate bounded summary counts without a new endpoint**

Reuse Task 2 with `pageSize=1` for these eight counts, in parallel with the active page:

```ts
const summaryQueries = [
  ["actionable", "pending"],
  ["advisory", "pending"],
  ["actionable", "applying"],
  ["actionable", "reconciliation_needed"],
  ["actionable", "completed"],
  ["advisory", "completed"],
  ["actionable", "failed"],
  ["advisory", "failed"],
] as const;
```

Display five queue cards: Actionable, Advisory, Applying/Reconciliation (sum its two totals), Completed (sum both execution classes), and Failed (sum both execution classes). Keep image totals and image optimization progress in the existing image section, below the queue summary.

- [ ] **Step 5: Implement view, status, search, page, and empty-state controls**

Use two Polaris `Tabs` for execution class, a `Select` for status, a labelled search field with explicit submit, and Previous/Next buttons:

```tsx
<Button disabled={page === 1 || tasksLoading} onClick={() => setPage((value) => value - 1)}>
  Previous page
</Button>
<Text as="p">Page {taskPage.page} · {taskPage.total} matching tasks</Text>
<Button disabled={!taskPage.hasMore || tasksLoading} onClick={() => setPage((value) => value + 1)}>
  Next page
</Button>
```

Use distinct empty copy: “No actionable tasks match these filters.” and “No advisory references match these filters.” Advisory rows retain Dismiss but never show Apply/Execute.

- [ ] **Step 6: Render grouped links semantically and demote raw HTML**

In `MapTaskDetails.tsx`, parse `sourceData.links` as bounded `{ toUrl, anchor }` values. For internal-link actions render:

```tsx
<BlockStack gap="200">
  <Text as="h3" variant="headingSm">Links to add ({links.length})</Text>
  {links.map((link) => (
    <BlockStack key={`${link.toUrl}:${link.anchor}`} gap="050">
      <Text as="p" fontWeight="semibold">{link.anchor}</Text>
      <Text as="p" variant="bodySm" tone="subdued">{link.toUrl}</Text>
    </BlockStack>
  ))}
</BlockStack>
```

Do not show `bodyHtml` in the default field list for internal-link tasks. Put the existing bounded before/after previews under one `Collapsible` opened by “Show raw HTML diagnostic”. SEO title/description and ordinary content changes keep their current field comparison.

- [ ] **Step 7: Verify Task 3**

Run:

```bash
npm test -- __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts __tests__/lib/store-tasks/dto.test.ts
npm run typecheck
git diff --check
```

Expected: component and source regressions PASS, typecheck exits 0, diff check is clean.

- [ ] **Step 8: Commit Task 3**

```bash
git add 'app/(embedded)/(store-pilot)/store-pilot/page.tsx' 'app/(embedded)/(store-pilot)/store-pilot/components/MapTaskDetails.tsx' 'app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx' __tests__/components/store-pilot-map-actions.test.tsx __tests__/components/store-pilot-source.test.ts
git commit -m "feat(store): separate actionable map work"
```

---

### Task 4: Target-Specific Approval Execution

**Files:**

- Modify: `jobs/execute-approved.ts`
- Modify: `__tests__/jobs/execute-approved.test.ts`
- Modify: `__tests__/jobs/execute-approved-store-task.test.ts`
- Create: `app/api/store-tasks/[id]/execute/route.ts`
- Create: `__tests__/api/store-task-execute-route.test.ts`
- Modify: `app/(embedded)/(store-pilot)/store-pilot/page.tsx`
- Modify: `app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx`
- Modify: `__tests__/components/store-pilot-map-actions.test.tsx`

**Interfaces:**

- Extends:

```ts
export type ExecuteApprovedOptions = {
  liveRequested?: boolean;
  triggeredBy?: string;
  recommendationId?: string;
};
```

- When `recommendationId` is present, `executeApprovedHandler` considers zero or one matching approved recommendation. When absent, its scheduled ordered batch of at most ten remains unchanged.
- `POST /api/store-tasks/:id/execute` accepts no proposed bytes or arbitrary recommendation ID from the browser.

- [ ] **Step 1: Write failing exact-selection tests**

In `__tests__/jobs/execute-approved-store-task.test.ts`, call:

```ts
await executeApprovedHandler({
  liveRequested: true,
  triggeredBy: "store-pilot:operator-1",
  recommendationId: "selected-rec",
});
```

Assert the selection query contains `id: "selected-rec"`, approved statuses, and `take: 1`; assert another approved mock recommendation is never dispatched. In `execute-approved.test.ts`, assert an options object without `recommendationId` still uses `take: 10` and `orderBy: { reviewedAt: "asc" }`.

- [ ] **Step 2: Run executor tests and verify exact selection is not implemented**

Run:

```bash
npm test -- __tests__/jobs/execute-approved.test.ts __tests__/jobs/execute-approved-store-task.test.ts
```

Expected: FAIL because the handler type and query do not accept `recommendationId`.

- [ ] **Step 3: Implement exact-or-batch selection in the existing handler**

Export `ExecuteApprovedOptions`. Replace only the approved selection query:

```ts
const approved = await prisma.recommendation.findMany({
  where: {
    status: { in: ["approved", "override_approved"] },
    ...(options.recommendationId ? { id: options.recommendationId } : {}),
  },
  take: options.recommendationId ? 1 : 10,
  orderBy: { reviewedAt: "asc" },
});
```

Preserve stale recovery, live-mode resolution, guardrails, dispatcher support checks, idempotency claim, and target locks. Scope stale recovery to `id: options.recommendationId` when exact execution is requested, so the operator request cannot reconcile unrelated recommendations; when the option is absent, keep the existing global stale-recovery behavior unchanged.

```ts
const staleRecs = await prisma.recommendation.findMany({
  where: {
    status: "executing",
    updatedAt: { lt: staleThreshold },
    ...(options.recommendationId ? { id: options.recommendationId } : {}),
  },
});
```

Extend the exact-selection test to include an unrelated stale executing recommendation and assert it is neither reobserved nor updated.

- [ ] **Step 4: Write failing route tests for authentication, permission, linkage, and bounded dispatch**

Create `__tests__/api/store-task-execute-route.test.ts`. Assert:

1. `requireAppAuth` is the first boundary.
2. `CONTENT_PUBLISH` is checked before params/Prisma/handler.
3. Missing task, malformed source, or non-approved linked recommendation returns a safe `409`.
4. The route verifies `targetEntityId === task.id`, platform `shopify`, and action `apply_topical_map_store_task`.
5. Success calls the handler exactly once with the linked ID and `liveRequested: true`.

```ts
expect(executeApprovedHandler).toHaveBeenCalledWith({
  liveRequested: true,
  triggeredBy: "store-pilot:operator-1",
  recommendationId: "rec-1",
});
```

- [ ] **Step 5: Implement the narrow execution route**

Create `app/api/store-tasks/[id]/execute/route.ts` with `dynamic = "force-dynamic"`. After auth and permission, load the task with a bounded select, parse `sourceData` through `TopicalMapStoreTaskSourceSchema`, require `executable: true` and its persisted `recommendationId`, and verify the linked recommendation with `findFirst`:

```ts
where: {
  id: source.data.recommendationId,
  targetEntityId: task.id,
  platform: "shopify",
  actionType: "apply_topical_map_store_task",
  status: { in: ["approved", "override_approved"] },
}
```

Then call the target-specific handler and reload only `{ id, status, completionNote }` for the requested Store Task. If the handler reports `considered: 0`, return `409` because the recommendation lost its approved claim between validation and dispatch. Otherwise return only:

```ts
{
  runId: result.runId,
  status: result.status,
  summary: result.summary,
  errors: result.errors,
  task: { id: refreshed.id, status: refreshed.status, completionNote: refreshed.completionNote },
}
```

Never return recommendation source bytes, connector payloads, or credentials. If the live gate is disabled, the handler remains a dry run and the response must say so through its existing `summary.dryRun`/`simulated` fields; the UI must not describe that result as a Shopify change.

- [ ] **Step 6: Wire an explicit two-stage modal flow**

In `ApplyMapTaskModal.tsx`, accept `stage: "review" | "approved"`, `onApprove`, and `onExecute`. Copy and actions must be exact:

```tsx
stage === "review"
  ? { title: "Approve topical-map change", primary: "Approve and queue" }
  : { title: "Execute approved topical-map change", primary: "Execute approved change" }
```

The review message states that approval does not change Shopify. The approved-stage message states that execution is limited to this target and still requires the server live gate. In `page.tsx`, retain the returned `recommendationId` locally, move the open modal to `approved`, and call `/api/store-tasks/${task.id}/execute` only from the second explicit click. Close and reload after a terminal response.

- [ ] **Step 7: Verify Task 4**

Run:

```bash
npm test -- __tests__/jobs/execute-approved.test.ts __tests__/jobs/execute-approved-store-task.test.ts __tests__/api/store-task-execute-route.test.ts __tests__/components/store-pilot-map-actions.test.tsx __tests__/api/topical-map-store-tasks.test.ts
npm run typecheck
git diff --check
```

Expected: all focused tests PASS, scheduled selection remains at ten, exact selection is at most one, and typecheck/diff pass.

- [ ] **Step 8: Commit Task 4**

```bash
git add jobs/execute-approved.ts app/api/store-tasks/'[id]'/execute/route.ts 'app/(embedded)/(store-pilot)/store-pilot/page.tsx' 'app/(embedded)/(store-pilot)/store-pilot/components/ApplyMapTaskModal.tsx' __tests__/jobs/execute-approved.test.ts __tests__/jobs/execute-approved-store-task.test.ts __tests__/api/store-task-execute-route.test.ts __tests__/components/store-pilot-map-actions.test.tsx
git commit -m "feat(store): execute one approved map task"
```

---

### Task 5: Superseded Work and Safe Durable Diagnostics

**Files:**

- Modify: `lib/store-tasks/apply-topical-map.ts`
- Modify: `jobs/execute-approved.ts`
- Modify: `__tests__/lib/store-tasks/apply-topical-map.test.ts`
- Modify: `__tests__/jobs/execute-approved-store-task.test.ts`
- Modify: `app/(embedded)/(store-pilot)/store-pilot/page.tsx`
- Modify: `__tests__/components/store-pilot-map-actions.test.tsx`

**Interfaces:**

- Produces safe diagnostic details:

```ts
export type TopicalMapApplyDiagnostic = {
  mutationSent: boolean;
  shopifyMessage?: string;
  reobservation: "expected_state" | "different_state" | "unavailable" | "not_attempted";
};

export class TopicalMapApplyError extends Error {
  constructor(
    public readonly code: TopicalMapApplyErrorCode,
    public readonly diagnostic?: TopicalMapApplyDiagnostic,
  );
}
```

- Typed stale codes are `APPROVED_BYTES_CHANGED`, `OBSERVATION_CHANGED`, `STRATEGY_CHANGED`, and `RULE_CHANGED`.
- Produces an added `superseded` execution counter; stale conflicts do not increment `failed`.

- [ ] **Step 1: Write failing diagnostics and stale-classification tests**

Add service tests for a Shopify error with a secret-looking raw property and a safe `message`. Assert the thrown diagnostic contains only:

```ts
{
  mutationSent: true,
  shopifyMessage: "Title is too long",
  reobservation: "different_state",
}
```

Add executor table tests for all four stale codes. Each must assert StoreTask `dismissed`, Recommendation `rejected`, lock released, `superseded: 1`, `failed: 0`, and one awaited transaction containing the audit. Add separate genuine Shopify uncertainty and finalization-failure tests to preserve `reconciliation_needed` behavior.

- [ ] **Step 2: Run the focused tests and verify current behavior reports stale work as failed**

Run:

```bash
npm test -- __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/jobs/execute-approved-store-task.test.ts
```

Expected: FAIL because diagnostics are discarded and stale codes enter the generic failure path.

- [ ] **Step 3: Preserve bounded Shopify diagnostics and reobserve after an error**

In `dispatchClaimedTopicalMapStoreTask`, set `mutationSent = true` immediately before `applyGovernedStoreResourceChange`. On error, perform one bounded `fetchGovernedStoreResource(source.targetUrl)` reobservation. If it matches the expected after-state, return a normal verified receipt. Otherwise throw `SHOPIFY_VERIFICATION_UNCERTAIN` with:

```ts
const shopifyMessage = error instanceof Error
  ? error.message.replace(/[\r\n\t]+/g, " ").slice(0, 300)
  : undefined;
```

Set reobservation to `different_state` or `unavailable`. Do not serialize the original error object, request variables, full HTML, stack, token, or database details.

- [ ] **Step 4: Classify stale conflicts before the generic connector-failure branch**

In the topical-map catch block of `execute-approved.ts`, inspect the typed code. For stale codes, execute one awaited transaction:

```ts
await prisma.$transaction([
  prisma.storeTask.updateMany({
    where: { id: rec.targetEntityId, status: { in: ["pending", "applying"] } },
    data: {
      status: "dismissed",
      completedAt: new Date(),
      completionNote: `Superseded (${code}). Sync topical map to create current work.`,
    },
  }),
  prisma.recommendation.updateMany({
    where: { id: rec.id, status: "executing" },
    data: {
      status: "rejected",
      reviewedBy: "execute-approved",
      reviewedAt: new Date(),
      reviewNote: `Superseded topical-map work: ${code}`,
      executionResult: json({ code, superseded: true, jobRunId: run.id }),
    },
  }),
  prisma.storeTaskExecutionLock.deleteMany({ where: { taskId: rec.targetEntityId, ownerId: rec.id } }),
  prisma.auditLog.create({
    data: {
      actor: "system",
      action: "topical_map_store_task_superseded",
      entityType: "StoreTask",
      entityId: rec.targetEntityId,
      after: json({ code, recommendationId: rec.id }),
      meta: { jobRunId: run.id },
    },
  }),
]);
```

Increment `superseded`, not `failed`. Do not alert `execution_failed` for this path.

- [ ] **Step 5: Make every genuine terminal path await its audit**

Remove the detached `const audit = prisma.auditLog.create(...)` pattern from branches that can `continue`. Include the audit in the same awaited transaction as state changes, or explicitly `await audit` before continuing. For genuine Shopify failures, persist only `{ code, mutationSent, shopifyMessage, reobservation, jobRunId }` plus identifiers and intended-change metadata already considered safe.

If an audit write fails, let the transaction/job fail; do not suppress it with `.catch(() => undefined)`. Best-effort reconciliation markers may remain best effort only when local finalization has already failed after a verified Shopify write, but their fallback audit failure must be included in the job error.

- [ ] **Step 6: Show typed stale guidance in Store Pilot**

When the execution route returns `task.status === "dismissed"` with a superseded completion note, show: “This task was superseded because the strategy or store state changed. Sync topical map to create current work.” Keep the Sync action available. When `summary.dryRun === true`, show: “The live execution gate is disabled; the approved recommendation remains queued and Shopify was not changed.” Do not label either result a Shopify connector failure.

- [ ] **Step 7: Verify Task 5**

Run:

```bash
npm test -- __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/jobs/execute-approved-store-task.test.ts __tests__/components/store-pilot-map-actions.test.tsx
npm run typecheck
git diff --check
```

Expected: all stale-code cases PASS as superseded, actual uncertainty still reconciles, diagnostics remain bounded, and every audit assertion is awaited.

- [ ] **Step 8: Commit Task 5**

```bash
git add lib/store-tasks/apply-topical-map.ts jobs/execute-approved.ts 'app/(embedded)/(store-pilot)/store-pilot/page.tsx' __tests__/lib/store-tasks/apply-topical-map.test.ts __tests__/jobs/execute-approved-store-task.test.ts __tests__/components/store-pilot-map-actions.test.tsx
git commit -m "fix(store): classify superseded map execution"
```

---

### Task 6: URL-Level Seven-Day GSC Outcomes

**Files:**

- Modify: `lib/connectors/gsc.ts`
- Create: `__tests__/lib/connectors/gsc.test.ts`
- Create: `lib/recommendations/topical-map-outcome.ts`
- Create: `__tests__/lib/recommendations/topical-map-outcome.test.ts`
- Modify: `jobs/check-outcomes.ts`
- Modify: `__tests__/jobs/check-outcomes.test.ts`

**Interfaces:**

- Produces:

```ts
export type GscPageMetrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  avgPosition: number | null;
};

export async function fetchGscPageMetrics(input: {
  startDate: string;
  endDate: string;
  pageUrl: string;
}): Promise<GscPageMetrics | null>;

export type TopicalMapSeoOutcome = {
  kind: "topical_map_url_gsc";
  verdict: "improved" | "worsened" | "neutral" | "insufficient_data";
  reason?: "missing_receipt_url" | "before_window_empty" | "after_window_empty" | "gsc_unavailable";
  targetUrl: string;
  windowDays: 7;
  beforeWindow: { startDate: string; endDate: string };
  afterWindow: { startDate: string; endDate: string };
  metricsBefore: GscPageMetrics | null;
  metricsAfter: GscPageMetrics | null;
  deltas: Record<string, { before: number; after: number; deltaPercent: number | null }>;
  checkedAt: string;
  storeRevenue: { before: number | null; after: number | null; windowDays: number };
};
```

- Search Console dates are inclusive and expressed as `YYYY-MM-DD`; exclude the execution calendar day, using the seven preceding and seven following complete calendar days.
- Use finalized GSC data. Defer the topical-map outcome until the after window plus `GSC_LAG_DAYS` (default `3`) has elapsed.

- [ ] **Step 1: Write failing pure window and verdict tests**

In `__tests__/lib/recommendations/topical-map-outcome.test.ts`, freeze an execution date and assert:

```ts
expect(topicalMapGscWindows(new Date("2026-07-14T10:00:00Z"))).toEqual({
  before: { startDate: "2026-07-07", endDate: "2026-07-13" },
  after: { startDate: "2026-07-15", endDate: "2026-07-21" },
});
```

Add verdict cases: clicks improve by more than 5%; zero-click baseline falls back to impressions; lower average position is improvement when traffic baselines cannot decide; changes within 5% are neutral; either missing window is `insufficient_data` with the correct typed reason.

- [ ] **Step 2: Run the pure test and verify the evaluator is absent**

Run: `npm test -- __tests__/lib/recommendations/topical-map-outcome.test.ts`

Expected: FAIL because the outcome module does not exist.

- [ ] **Step 3: Implement the pure date and metric evaluator**

Create `topical-map-outcome.ts`. Generate inclusive seven-day dates with UTC calendar arithmetic matching the existing connector convention, excluding the execution date. Compute deltas for clicks, impressions, CTR, and average position. Pick the primary metric in this order when both windows contain it and the baseline is nonzero: clicks, impressions, average position. Apply the existing 5% threshold; invert average-position direction because lower is better. Return `insufficient_data` rather than inventing a delta from a zero or missing baseline.

- [ ] **Step 4: Add one exact page-filtered Search Analytics connector call**

In `lib/connectors/gsc.ts`, reuse `getAccessToken()` and `GSC_SITE_URL`. Send:

```ts
const body = {
  startDate: input.startDate,
  endDate: input.endDate,
  dataState: "final",
  aggregationType: "byPage",
  dimensionFilterGroups: [{
    groupType: "and",
    filters: [{ dimension: "page", operator: "equals", expression: input.pageUrl }],
  }],
  rowLimit: 1,
};
```

Use no dimensions so the response is one aggregate row. Return its `clicks`, `impressions`, fractional `ctr`, and `position` as `avgPosition`; return `null` when `rows` is empty. Keep the existing 30-second timeout. On non-2xx, throw only `GSC API error ${res.status}`; do not persist or propagate the Google response body.

Create `__tests__/lib/connectors/gsc.test.ts` with mocked configuration, auth, and `fetch`. Assert the request uses the exact inclusive dates, `dataState: "final"`, `aggregationType: "byPage"`, one `page equals` filter, no `dimensions`, and `rowLimit: 1`. Also assert a row maps to the bounded metric object, an empty row array maps to `null`, and a non-2xx response throws only the existing bounded status error.

- [ ] **Step 5: Write failing job routing and exact-window tests**

Mock `fetchGscPageMetrics`. For `platform: "shopify"`, `actionType: "apply_topical_map_store_task"`, and an execution receipt containing `targetUrl: "/products/red-rice"`, assert two connector calls use the absolute governed URL and exact windows. Assert generic Meta recommendations still use `RawSnapshot`. Add a lag test where the after window is not finalized: no outcome update occurs, and the recommendation remains eligible for the next job run.

- [ ] **Step 6: Route only topical-map executions through the new evaluator**

In `check-outcomes.ts`, branch before `platformSources(...)` when:

```ts
rec.platform === "shopify" && rec.actionType === "apply_topical_map_store_task"
```

Read `targetUrl` from the verified `executionResult` receipt, normalize it to `https://agrikoph.com/...`, calculate the windows, and defer until `after.endDate + GSC_LAG_DAYS` is complete. Fetch before and after metrics in parallel. Persist a typed insufficient-data outcome for a missing receipt URL, empty window, or connector failure; connector failure is safe text/code only and does not fail the entire outcome batch.

Compute the same advisory `storeRevenue` context with `windowDays: 7`, but never feed revenue into the SEO verdict. Index into the knowledge base only when the verdict is not `insufficient_data`, preserving the current fail-safe indexing behavior.

- [ ] **Step 7: Verify Task 6**

Run:

```bash
npm test -- __tests__/lib/recommendations/topical-map-outcome.test.ts __tests__/jobs/check-outcomes.test.ts __tests__/lib/seo/gsc-normalized.test.ts
npm test -- __tests__/lib/connectors/gsc.test.ts
npm run typecheck
git diff --check
```

Expected: exact-window and route tests PASS; existing normalized GSC behavior remains unchanged; typecheck and diff pass.

- [ ] **Step 8: Commit Task 6**

```bash
git add lib/connectors/gsc.ts lib/recommendations/topical-map-outcome.ts jobs/check-outcomes.ts __tests__/lib/connectors/gsc.test.ts __tests__/lib/recommendations/topical-map-outcome.test.ts __tests__/jobs/check-outcomes.test.ts
git commit -m "feat(seo): measure topical map URL outcomes"
```

---

### Task 7: Whole-Feature Verification, GROW Record, and Cleanup Runbook

**Files:**

- Modify: `.mex/ROUTER.md`
- Modify: `.mex/context/architecture.md`
- Review only: `docs/superpowers/specs/2026-07-14-topical-map-integration-remediation-design.md`

**Interfaces:**

- Consumes all Task 1–6 commits.
- Produces a locally verified remediation branch and an exact, separately authorized production cleanup procedure.

- [ ] **Step 1: Run the complete focused regression gate**

```bash
npm test -- \
  __tests__/lib/store-tasks/topical-map.test.ts \
  __tests__/lib/store-tasks/apply-topical-map.test.ts \
  __tests__/lib/store-tasks/dto.test.ts \
  __tests__/api/store-tasks-route.test.ts \
  __tests__/api/topical-map-store-tasks.test.ts \
  __tests__/api/store-task-execute-route.test.ts \
  __tests__/components/store-pilot-map-actions.test.tsx \
  __tests__/components/store-pilot-source.test.ts \
  __tests__/jobs/execute-approved.test.ts \
  __tests__/jobs/execute-approved-store-task.test.ts \
  __tests__/lib/recommendations/topical-map-outcome.test.ts \
  __tests__/lib/connectors/gsc.test.ts \
  __tests__/jobs/check-outcomes.test.ts
```

Expected: every listed test passes with zero failures.

- [ ] **Step 2: Run repository-wide static and behavioral gates**

```bash
npm test
npm run typecheck
npm run typecheck:test
npm run lint
npm run build:local
git diff --check
git status --short
```

Expected: full tests and both typechecks exit 0; lint has zero errors; local production build exits 0; diff check prints nothing; status lists only intended documentation edits before the final commit.

- [ ] **Step 3: Inspect invariant-sensitive diffs directly**

```bash
git diff HEAD~6 -- jobs/execute-approved.ts lib/store-tasks/apply-topical-map.ts app/api/store-tasks/'[id]'/execute/route.ts
rg -n 'EXECUTE_APPROVED_LIVE_ENABLED|approved|override_approved|CONTENT_PUBLISH|APPROVED_BYTES_CHANGED|TARGET_LOCKED' jobs/execute-approved.ts lib/store-tasks/apply-topical-map.ts app/api/store-tasks/'[id]'/execute/route.ts
rg -n 'redirect_execution_unsupported|canonicalization_execution_prohibited|indexation_execution_prohibited|homepage_not_governed|blog_index_not_governed' lib/store-tasks/topical-map.ts
```

Expected: the live gate, approved statuses, publish permission, hash/lock checks, and advisory prohibitions are all present; no new live authority exists.

- [ ] **Step 4: Perform GROW documentation updates**

Update `.mex/ROUTER.md` Current Project State with observed behavior and verification counts. Update `.mex/context/architecture.md` to record:

```text
Store Pilot queries one bounded actionable/advisory page at a time with database-backed totals. Approval and execution are distinct operator actions; the execution endpoint delegates only the persisted linked recommendation to execute-approved, whose scheduled batch behavior is unchanged. Stale strategy/state conflicts are superseded, while actual Shopify uncertainty remains reconciliation work. Executed topical-map Store Tasks use exact URL-level seven-day GSC windows for outcomes.
```

Bump `last_updated` in both scaffold files to the actual completion timestamp. Do not create a new runbook: the existing Store Task and deployment patterns cover this work, and the cleanup command is self-describing and idempotent.

- [ ] **Step 5: Record the rationale and commit Task 7**

```bash
mex log --type decision "Topical-map remediation keeps the existing governed StoreTask and execute-approved lifecycle, adds exact target dispatch and truthful queue/outcome boundaries, and does not expand Shopify execution authority."
git add .mex/ROUTER.md .mex/context/architecture.md
git commit -m "docs: record topical map remediation"
```

- [ ] **Step 6: Re-run the final cleanliness check**

```bash
git status --short
git log -7 --oneline
```

Expected: clean worktree and seven ordered remediation commits.

## Separately Authorized Production Procedure

These commands are documented for the later deployment/cleanup operation; they are not authorized by approving this local implementation plan.

1. Deploy the verified commit through the existing `.mex/patterns/deploy.md` procedure and prove server commit, active build artifact, PM2 restart, and public health match.
2. Before cleanup writes, run the production dry run:

```bash
ssh autopilot-prod 'cd /opt/autopilot && npm run store-tasks:cleanup-topical-map-advisories'
```

Expected from the currently observed inventory: `duplicates` reports `477` and `dismissed` reports `0`. If the count differs, inspect the semantic-group report before any write.
3. With explicit production-cleanup authority, apply once:

```bash
ssh autopilot-prod 'cd /opt/autopilot && npm run store-tasks:cleanup-topical-map-advisories -- --apply'
```

Expected: `dismissed` equals the dry-run duplicate count and no deletes are reported.
4. Re-run the dry run:

```bash
ssh autopilot-prod 'cd /opt/autopilot && npm run store-tasks:cleanup-topical-map-advisories'
```

Expected: `duplicates: 0`, `dismissed: 0`.
5. Verify database and UI acceptance: one pending advisory per semantic key, truthful API totals across all pages, actionable/advisory separation, and zero changes to completed tasks, receipts, executed recommendations, active strategy identity, or live authorization flags.

---

## Acceptance Checklist

- [ ] One pending or failed advisory exists per semantic key; rerunning sync or cleanup creates no duplicate.
- [ ] `GET /api/store-tasks` totals come from the same database predicate as page data, with page size default `50` and maximum `100`.
- [ ] Store Pilot separates actionable work from advisory references and exposes every matching task through pagination.
- [ ] Grouped internal-link review lists every bounded anchor/destination pair; raw HTML is secondary.
- [ ] Approval alone never calls Shopify.
- [ ] Executing one selected task cannot process another approved recommendation.
- [ ] Scheduled `execute-approved` still processes its existing ordered batch when no recommendation ID is supplied.
- [ ] Stale bytes, observations, strategies, and rules end as audited superseded work rather than connector failures.
- [ ] Genuine Shopify failure/reconciliation paths retain safe diagnostics and durable awaited audits.
- [ ] Executed topical-map recommendations receive exact URL-level GSC metrics or a typed insufficient-data reason.
- [ ] Redirect, canonical, indexation, homepage, blog-index, and unavailable-draft work remains advisory-only.
- [ ] No schema migration, new queue framework, autonomous action, deployment, activation, or production write is introduced by local implementation.
