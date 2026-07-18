# Content Pilot Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show exact topical-map work available now and locked future phase work in Content Pilot, even when current SEO analysis needs refreshing.

**Architecture:** Extend the authenticated map-suggestions route to read future phase tasks for the active strategy and treat current analysis as an optional action-enabling overlay. Extend the existing Brief tab response types and render one read-only upcoming section; preserve all existing current-candidate mutation gates.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, React, Shopify Polaris, Vitest.

## Global Constraints

- Every returned topic, URL, obligation, and date must come from the active topical map, its current-strategy scheduled tasks, or current strategy-bound analysis.
- Future phase work is display-only and has no brief, queue, publish, or mutation control.
- Current actions remain unavailable unless SEO analysis is current and matches the active strategy.
- The route must call `await requireAppAuth(req)` as its first handler statement.
- Use the shared `prisma` import from `@/lib/db`; do not instantiate `PrismaClient`.
- Do not alter Shopify, Meta, the database schema, the topical-map package, or task scheduling.

---

### Task 1: Return current and future mapped work independently

**Files:**
- Modify: `__tests__/api/content-pilot-map-suggestions-route.test.ts`
- Modify: `app/api/content-pilot/map-suggestions/route.ts`

**Interfaces:**
- Consumes: active `TopicalMapCommandCenter`, latest `seo_analysis` snapshot, and open `SeoFollowUpTask` records with current-strategy source identity.
- Produces: `currentWork: { status: "current" | "refresh_required"; reason: string | null }`, nullable `strategy.analysisGeneratedAt`, existing `actionable` and `research` arrays, and `upcoming` phase rows.

- [ ] **Step 1: Write failing route tests**

Add a hoisted `tasks` mock, expose it through `prisma.seoFollowUpTask.findMany`, and default it to one future phase:

```ts
mocks.tasks.mockResolvedValue([{
  id: "phase-1",
  title: "Review topical-map phase: Rice Nutrition",
  description: "1. Refresh the mapped rice nutrition page.",
  priority: "P2",
  earliestReviewAt: new Date("2026-08-07T16:00:00.000Z"),
  dueAt: new Date("2026-08-16T15:59:59.999Z"),
  sourceData: {
    strategyVersionId: "strategy-1",
    packageSha256: "a".repeat(64),
    phase: { label: "Rice Nutrition", startDay: 22, endDay: 30 },
    ruleIds: ["schedule:rice"],
  },
}]);
```

Assert that the current-analysis case returns `currentWork.status === "current"` and the exact future phase fields. Replace the stale-analysis 409 assertion with:

```ts
expect(response.status).toBe(200);
expect(body.currentWork.status).toBe("refresh_required");
expect(body.actionable).toEqual([]);
expect(body.research).toEqual([]);
expect(body.upcoming).toHaveLength(1);
```

Add one test whose task `sourceData` has another strategy ID or package hash and assert `body.upcoming` is empty.

- [ ] **Step 2: Run the route tests and verify RED**

Run:

```bash
npx vitest run __tests__/api/content-pilot-map-suggestions-route.test.ts
```

Expected: FAIL because stale analysis still returns 409 and the response has no `currentWork` or `upcoming`.

- [ ] **Step 3: Implement the minimal authenticated route behavior**

After the auth gate, load the active command center and fail closed if absent. Query at most 100 open future tasks using the immutable current-strategy source-key prefix:

```ts
const phaseTasks = await prisma.seoFollowUpTask.findMany({
  where: {
    status: "open",
    sourceType: "topical_map",
    sourceKey: { startsWith: `topical-map-phase:${commandCenter.identity.versionId}:` },
    earliestReviewAt: { gt: now },
  },
  orderBy: [{ earliestReviewAt: "asc" }, { id: "asc" }],
  take: 100,
  select: {
    id: true,
    title: true,
    description: true,
    priority: true,
    earliestReviewAt: true,
    dueAt: true,
    sourceData: true,
  },
});
```

Filter each task again in memory so `sourceData.strategyVersionId` and `sourceData.packageSha256` exactly match the active identity. Project only persisted title, description, priority, dates, phase label, and sorted rule IDs.

Treat analysis as current only when the snapshot has a string `generatedAt`, `analysisEvidenceState(...) === "current"`, and `readAnalysisForStrategy(...)` succeeds. Otherwise return:

```ts
currentWork: {
  status: "refresh_required",
  reason: "Current strategy-bound SEO analysis must be refreshed.",
},
actionable: [],
research: [],
```

Always return the validated `upcoming` array. Keep current actionable and research projection unchanged when analysis is current.

- [ ] **Step 4: Run the route tests and verify GREEN**

Run:

```bash
npx vitest run __tests__/api/content-pilot-map-suggestions-route.test.ts
```

Expected: all route tests pass.

### Task 2: Render a locked current-and-future roadmap

**Files:**
- Modify: `__tests__/components/content-pilot-brief-tab.test.ts`
- Modify: `app/(embedded)/(content-pilot)/content-pilot/components/types.ts`
- Modify: `app/(embedded)/(content-pilot)/content-pilot/components/BriefTab.tsx`

**Interfaces:**
- Consumes: the Task 1 map-suggestions response.
- Produces: “Available now”, “Upcoming mapped phases”, and “Mapped research only” cards, with current actions only in the first card.

- [ ] **Step 1: Write the failing UI contract test**

Update the source contract test to require:

```ts
expect(source).toContain("Available now");
expect(source).toContain("Upcoming mapped phases");
expect(source).toContain("Current analysis needs refreshing");
expect(source).toContain("Asia/Manila");

const upcoming = source.slice(
  source.indexOf("Upcoming mapped phases"),
  source.indexOf("Mapped research only"),
);
expect(upcoming).not.toContain("<Button");
```

Keep the existing assertions that free-form topics and the manual proposal route are absent.

- [ ] **Step 2: Run the UI contract test and verify RED**

Run:

```bash
npx vitest run __tests__/components/content-pilot-brief-tab.test.ts
```

Expected: FAIL because the upcoming section and refresh-required message do not exist.

- [ ] **Step 3: Add response types and the minimal UI**

Add:

```ts
export interface ContentMapUpcomingPhase {
  taskId: string;
  title: string;
  obligations: string;
  priority: string;
  earliestReviewAt: string;
  dueAt: string | null;
  phaseLabel: string | null;
  ruleIds: string[];
}
```

Extend `ContentMapSuggestionsResponse` with `currentWork`, nullable `analysisGeneratedAt`, and `upcoming`.

Rename the current card heading to **Available now**. When `currentWork.status === "refresh_required"`, show an attention banner stating that current analysis needs refreshing and current actions are unavailable.

Add **Upcoming mapped phases** between the current and research cards. Format persisted dates with:

```ts
new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
})
```

Render the exact stored title and obligation text, priority, and review window. Do not add a `Button`, click handler, brief action, or queue action to this section.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npx vitest run \
  __tests__/api/content-pilot-map-suggestions-route.test.ts \
  __tests__/components/content-pilot-brief-tab.test.ts \
  __tests__/api/content-pilot-brief-route.test.ts \
  __tests__/api/content-pilot-routes.test.ts
npx tsc --noEmit --incremental false
git diff --check
```

Expected: all focused tests pass, TypeScript exits 0, and diff hygiene exits 0.

- [ ] **Step 5: Record the change and commit**

Update `.mex/ROUTER.md` and `.mex/events/decisions.jsonl` with the verified behavior, then commit only the approved implementation and its evidence:

```bash
git add \
  app/api/content-pilot/map-suggestions/route.ts \
  'app/(embedded)/(content-pilot)/content-pilot/components/types.ts' \
  'app/(embedded)/(content-pilot)/content-pilot/components/BriefTab.tsx' \
  __tests__/api/content-pilot-map-suggestions-route.test.ts \
  __tests__/components/content-pilot-brief-tab.test.ts \
  .mex/ROUTER.md \
  .mex/events/decisions.jsonl
git commit -m "feat(content): show future topical-map phases"
```

