# Dashboard v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 18 improvements to the Autopilot dashboard: richer backend counts (opportunities, market insights, store tasks, top pending recs, content SEO lift, DB latency), three new API endpoints (GSC movers, activity sparkline, per-job trigger), and a fully upgraded UI with alert banners, rec inbox, skill insight feed, sparklines, and auto-refresh.

**Architecture:** Backend changes extend `buildJobsStatusPayload` in `lib/dashboard/jobs-status.ts` with 7 new parallel queries. Three new focused endpoints live in `app/api/dashboard/`. All UI changes are in `app/(embedded)/page.tsx` — the page already imports from two endpoints; Tasks 5–7 add two more. Sparklines use inline CSS bars, no chart library. The `trigger-job` endpoint fires-and-forgets to existing cron routes via internal `fetch` with `CRON_SECRET`.

**Tech Stack:** Next.js 14 App Router, Prisma ORM, Shopify Polaris v12, Vitest, TypeScript strict.

## Global Constraints

- All DB access via `import { prisma } from "@/lib/db"` — never `new PrismaClient()`
- Every embedded app route: `export const dynamic = "force-dynamic"` + `await requireAppAuth(req)` first
- `CRON_SECRET` and `AUTOPILOT_API_KEY` are server-side only — never `NEXT_PUBLIC_*`
- Tests use Vitest (`vi.mock`, `describe`, `it`, `expect`, `beforeEach`)
- Path alias `@/` maps to project root — always use it, never relative `../../`
- `pause_ad` must NOT be added to `CONVERSION_SENSITIVE_ACTIONS` in `lib/guardrails.ts`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/dashboard/jobs-status.ts` | Modify | 7 new parallel queries + new payload fields |
| `lib/dashboard/gsc-movers.ts` | Create | `getGscMovers()` — top 3 risers + top 3 fallers |
| `lib/dashboard/activity-sparkline.ts` | Create | `getActivitySparkline()` — AuditLog counts per day, last 30d |
| `app/api/dashboard/gsc-movers/route.ts` | Create | `GET /api/dashboard/gsc-movers` |
| `app/api/dashboard/activity-sparkline/route.ts` | Create | `GET /api/dashboard/activity-sparkline` |
| `app/api/jobs/trigger-job/route.ts` | Create | `POST /api/jobs/trigger-job` — fire-and-forget to cron |
| `__tests__/lib/dashboard/jobs-status-v3.test.ts` | Create | Tests for 7 new payload fields |
| `__tests__/lib/dashboard/gsc-movers.test.ts` | Create | Tests for `getGscMovers` |
| `__tests__/lib/dashboard/activity-sparkline.test.ts` | Create | Tests for `getActivitySparkline` |
| `app/(embedded)/page.tsx` | Modify | Full UI upgrade — all 18 features |

---

## Task 1: Extend `buildJobsStatusPayload` with 7 new fields

**Files:**
- Modify: `lib/dashboard/jobs-status.ts`
- Create: `__tests__/lib/dashboard/jobs-status-v3.test.ts`

**Interfaces:**
- Produces (new fields added to `JobsStatusPayload`):
```ts
openOpportunities: { high: number; medium: number; low: number };
openMarketInsights: { critical: number; warning: number; info: number };
pendingStoreTasks: number;
topPendingRecs: Array<{
  id: string;
  actionType: string;
  targetEntityName: string;
  rationale: string;
  estimatedImpact: string | null;
  guardStatus: string;
}>;
recsPendingOver7Days: number;
contentLift: { count: number; avgLiftPts: number } | null;
dbLatencyMs: number;
```

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/dashboard/jobs-status-v3.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  recommendation: { groupBy: vi.fn(), count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
  jobRun: { findFirst: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  contentProposal: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  rawSnapshot: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  opportunity: { groupBy: vi.fn() },
  marketInsight: { groupBy: vi.fn() },
  storeTask: { count: vi.fn() },
  skillInsight: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { buildJobsStatusPayload } = await import("@/lib/dashboard/jobs-status");

function defaultMocks() {
  mockPrisma.recommendation.groupBy.mockResolvedValue([]);
  mockPrisma.recommendation.count.mockResolvedValue(0);
  mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: null } });
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.groupBy.mockResolvedValue([]);
  mockPrisma.jobRun.findMany.mockResolvedValue([]);
  mockPrisma.contentProposal.groupBy.mockResolvedValue([]);
  mockPrisma.contentProposal.count.mockResolvedValue(0);
  mockPrisma.contentProposal.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findUnique.mockResolvedValue(null);
  mockPrisma.opportunity.groupBy.mockResolvedValue([]);
  mockPrisma.marketInsight.groupBy.mockResolvedValue([]);
  mockPrisma.storeTask.count.mockResolvedValue(0);
  mockPrisma.skillInsight.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([{ latency_ms: BigInt(12) }]);
}

beforeEach(() => { vi.clearAllMocks(); defaultMocks(); });

describe("buildJobsStatusPayload – v3 fields", () => {
  it("returns openOpportunities grouped by priority", async () => {
    mockPrisma.opportunity.groupBy.mockResolvedValue([
      { priority: "high", _count: { _all: 3 } },
      { priority: "medium", _count: { _all: 5 } },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.openOpportunities.high).toBe(3);
    expect(result.openOpportunities.medium).toBe(5);
    expect(result.openOpportunities.low).toBe(0);
  });

  it("returns openMarketInsights grouped by severity", async () => {
    mockPrisma.marketInsight.groupBy.mockResolvedValue([
      { severity: "critical", _count: { _all: 2 } },
      { severity: "info", _count: { _all: 7 } },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.openMarketInsights.critical).toBe(2);
    expect(result.openMarketInsights.warning).toBe(0);
    expect(result.openMarketInsights.info).toBe(7);
  });

  it("returns pendingStoreTasks count", async () => {
    mockPrisma.storeTask.count.mockResolvedValue(4);

    const result = await buildJobsStatusPayload();

    expect(result.pendingStoreTasks).toBe(4);
  });

  it("returns topPendingRecs with correct shape", async () => {
    mockPrisma.recommendation.findMany.mockResolvedValue([
      {
        id: "rec-1",
        actionType: "pause_campaign",
        targetEntityName: "Summer Sale",
        rationale: "Low ROAS",
        estimatedImpact: "Save ₱500/day",
        guardStatus: "clear",
      },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.topPendingRecs).toHaveLength(1);
    expect(result.topPendingRecs[0]).toMatchObject({
      id: "rec-1",
      actionType: "pause_campaign",
      targetEntityName: "Summer Sale",
    });
  });

  it("returns recsPendingOver7Days from count query", async () => {
    // count is called multiple times; recsPendingOver7Days is a dedicated call
    mockPrisma.recommendation.count
      .mockResolvedValueOnce(1)  // hardBlockedCount
      .mockResolvedValueOnce(5)  // executedThisMonth
      .mockResolvedValueOnce(3); // recsPendingOver7Days

    const result = await buildJobsStatusPayload();

    expect(result.recsPendingOver7Days).toBe(3);
  });

  it("returns contentLift null when no proposals have both scores", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValue([]);

    const result = await buildJobsStatusPayload();

    expect(result.contentLift).toBeNull();
  });

  it("returns contentLift with correct avgLiftPts when scores exist", async () => {
    mockPrisma.contentProposal.findMany.mockResolvedValue([
      { baselineSeoScore: 60, followUpSeoScore: 75 },
      { baselineSeoScore: 50, followUpSeoScore: 70 },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.contentLift).not.toBeNull();
    expect(result.contentLift!.count).toBe(2);
    expect(result.contentLift!.avgLiftPts).toBeCloseTo(17.5);
  });

  it("returns dbLatencyMs as a number from $queryRaw", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ latency_ms: BigInt(42) }]);

    const result = await buildJobsStatusPayload();

    expect(result.dbLatencyMs).toBe(42);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- __tests__/lib/dashboard/jobs-status-v3.test.ts 2>&1 | tail -15
```

Expected: multiple failures — fields undefined.

- [ ] **Step 3: Update `JobsStatusPayload` type in `lib/dashboard/jobs-status.ts`**

Add to the type (after `estimatedValueExecuted`):

```ts
openOpportunities: { high: number; medium: number; low: number };
openMarketInsights: { critical: number; warning: number; info: number };
pendingStoreTasks: number;
topPendingRecs: Array<{
  id: string;
  actionType: string;
  targetEntityName: string;
  rationale: string;
  estimatedImpact: string | null;
  guardStatus: string;
}>;
recsPendingOver7Days: number;
contentLift: { count: number; avgLiftPts: number } | null;
dbLatencyMs: number;
```

- [ ] **Step 4: Add DB latency measurement before the Promise.all**

At the top of `buildJobsStatusPayload`, before the `Promise.all`, add:

```ts
const dbPingStart = Date.now();
await prisma.$queryRaw`SELECT 1 as latency_ms`;
const dbLatencyMs = Date.now() - dbPingStart;
```

Actually, use a raw ping for accuracy:

```ts
const dbPingStart = Date.now();
await prisma.$queryRaw`SELECT 1`;
const dbLatencyMs = Date.now() - dbPingStart;
```

- [ ] **Step 5: Add 7 new parallel queries to the Promise.all**

In `buildJobsStatusPayload`, extend the destructured array and `Promise.all` by appending after the existing 14 queries (after `estimatedValueAgg` and `latestInsightRows`):

```ts
// After latestInsightRows in the destructured array, add:
opportunityGroups,
marketInsightGroups,
pendingStoreTasksCount,
topPendingRecsRows,
recsPendingOver7DaysCount,
liftProposals,
```

And in the `Promise.all`, add after the existing last query:

```ts
prisma.opportunity.groupBy({
  by: ["priority"],
  where: { status: "open" },
  _count: { _all: true },
}),
prisma.marketInsight.groupBy({
  by: ["severity"],
  where: { status: "open" },
  _count: { _all: true },
}),
prisma.storeTask.count({ where: { status: "pending" } }),
prisma.recommendation.findMany({
  where: { status: "pending" },
  orderBy: [{ guardStatus: "desc" }, { createdAt: "asc" }],
  take: 5,
  select: {
    id: true,
    actionType: true,
    targetEntityName: true,
    rationale: true,
    estimatedImpact: true,
    guardStatus: true,
  },
}),
prisma.recommendation.count({
  where: {
    status: "pending",
    createdAt: { lte: new Date(Date.now() - 7 * 24 * 3600_000) },
  },
}),
prisma.contentProposal.findMany({
  where: {
    baselineSeoScore: { not: null },
    followUpSeoScore: { not: null },
  },
  select: { baselineSeoScore: true, followUpSeoScore: true },
}),
```

Note: `guardStatus: "desc"` puts "hard_block" before "soft_flag" before "clear" — surfaces the most critical recs first.

- [ ] **Step 6: Add processing logic before the return statement**

Add before `return {`:

```ts
const oppByPriority = new Map(opportunityGroups.map((r) => [r.priority, r._count._all]));
const openOpportunities = {
  high: oppByPriority.get("high") ?? 0,
  medium: oppByPriority.get("medium") ?? 0,
  low: oppByPriority.get("low") ?? 0,
};

const insightBySeverity = new Map(marketInsightGroups.map((r) => [r.severity, r._count._all]));
const openMarketInsights = {
  critical: insightBySeverity.get("critical") ?? 0,
  warning: insightBySeverity.get("warning") ?? 0,
  info: insightBySeverity.get("info") ?? 0,
};

const topPendingRecs = topPendingRecsRows.map((r) => ({
  id: r.id,
  actionType: r.actionType,
  targetEntityName: r.targetEntityName,
  rationale: r.rationale,
  estimatedImpact: r.estimatedImpact ?? null,
  guardStatus: r.guardStatus,
}));

const contentLift =
  liftProposals.length === 0
    ? null
    : {
        count: liftProposals.length,
        avgLiftPts:
          liftProposals.reduce(
            (sum, p) => sum + ((p.followUpSeoScore ?? 0) - (p.baselineSeoScore ?? 0)),
            0,
          ) / liftProposals.length,
      };
```

Add to the `return` object:

```ts
openOpportunities,
openMarketInsights,
pendingStoreTasks: pendingStoreTasksCount,
topPendingRecs,
recsPendingOver7Days: recsPendingOver7DaysCount,
contentLift,
dbLatencyMs,
```

- [ ] **Step 7: Run tests**

```bash
npm test -- __tests__/lib/dashboard/jobs-status-v3.test.ts 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 8: Run full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/dashboard/jobs-status.ts __tests__/lib/dashboard/jobs-status-v3.test.ts
git commit -m "feat(dashboard): extend payload with opportunities, market insights, store tasks, rec inbox, content lift, db latency"
```

---

## Task 2: New `GET /api/dashboard/gsc-movers` endpoint

**Files:**
- Create: `lib/dashboard/gsc-movers.ts`
- Create: `app/api/dashboard/gsc-movers/route.ts`
- Create: `__tests__/lib/dashboard/gsc-movers.test.ts`

**Interfaces:**
- Consumes: `getLatestGscData(): Promise<LatestGscData>`, `getPreviousGscQueries(current): Promise<GscQueryRow[] | null>`, `computeTrends(current, previous, fetchedAt, prevFetchedAt): SeoTrends` from `@/lib/seo/`
- Produces:
```ts
// GET /api/dashboard/gsc-movers response
{
  risers: QueryMover[];   // top 3, sorted by clicksDelta desc
  fallers: QueryMover[];  // top 3, sorted by clicksDelta asc
  fetchedAt: string | null;
}
```

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/dashboard/gsc-movers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/seo/data", () => ({
  getLatestGscData: vi.fn(),
  getPreviousGscQueries: vi.fn(),
}));

vi.mock("@/lib/seo/trends", () => ({
  computeTrends: vi.fn(),
}));

const { getLatestGscData, getPreviousGscQueries } = await import("@/lib/seo/data");
const { computeTrends } = await import("@/lib/seo/trends");
const { getGscMovers } = await import("@/lib/dashboard/gsc-movers");

beforeEach(() => vi.clearAllMocks());

describe("getGscMovers", () => {
  it("returns top 3 risers and top 3 fallers", async () => {
    const mockLatest = { queries: [], pages: [], fetchedAt: new Date("2026-06-25"), queryPagePairs: [], source: "normalized" as const };
    vi.mocked(getLatestGscData).mockResolvedValue(mockLatest);
    vi.mocked(getPreviousGscQueries).mockResolvedValue([]);
    vi.mocked(computeTrends).mockReturnValue({
      current: { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0 },
      previous: null,
      currentFetchedAt: "2026-06-25T00:00:00Z",
      previousFetchedAt: null,
      movers: [
        { query: "a", clicks: 10, clicksDelta: 8, impressionsDelta: 20, positionDelta: -1, direction: "up" },
        { query: "b", clicks: 8, clicksDelta: 6, impressionsDelta: 15, positionDelta: -2, direction: "up" },
        { query: "c", clicks: 6, clicksDelta: 4, impressionsDelta: 10, positionDelta: 0, direction: "up" },
        { query: "d", clicks: 5, clicksDelta: 3, impressionsDelta: 8, positionDelta: 1, direction: "up" },
        { query: "e", clicks: 2, clicksDelta: -5, impressionsDelta: -10, positionDelta: 3, direction: "down" },
        { query: "f", clicks: 1, clicksDelta: -7, impressionsDelta: -15, positionDelta: 5, direction: "down" },
        { query: "g", clicks: 0, clicksDelta: -9, impressionsDelta: -20, positionDelta: 7, direction: "down" },
        { query: "h", clicks: 0, clicksDelta: -12, impressionsDelta: -25, positionDelta: 9, direction: "down" },
      ],
    });

    const result = await getGscMovers();

    expect(result.risers).toHaveLength(3);
    expect(result.risers[0]!.query).toBe("a");
    expect(result.fallers).toHaveLength(3);
    expect(result.fallers[0]!.query).toBe("h");
  });

  it("returns empty arrays when no GSC data", async () => {
    vi.mocked(getLatestGscData).mockResolvedValue({ queries: [], pages: [], fetchedAt: null, queryPagePairs: [], source: "none" as const });
    vi.mocked(getPreviousGscQueries).mockResolvedValue(null);
    vi.mocked(computeTrends).mockReturnValue({
      current: { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0 },
      previous: null,
      currentFetchedAt: null,
      previousFetchedAt: null,
      movers: [],
    });

    const result = await getGscMovers();

    expect(result.risers).toHaveLength(0);
    expect(result.fallers).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- __tests__/lib/dashboard/gsc-movers.test.ts 2>&1 | tail -10
```

Expected: cannot find `@/lib/dashboard/gsc-movers`.

- [ ] **Step 3: Create `lib/dashboard/gsc-movers.ts`**

```ts
import { getLatestGscData, getPreviousGscQueries } from "@/lib/seo/data";
import { computeTrends } from "@/lib/seo/trends";
import type { QueryMover } from "@/lib/seo/types";

const MOVERS_PER_DIRECTION = 3;

export type GscMoversResult = {
  risers: QueryMover[];
  fallers: QueryMover[];
  fetchedAt: string | null;
};

export async function getGscMovers(): Promise<GscMoversResult> {
  const latest = await getLatestGscData();
  const previous = await getPreviousGscQueries(latest);

  const trends = computeTrends(
    latest.queries,
    previous,
    latest.fetchedAt?.toISOString() ?? null,
    null,
  );

  const risers = [...trends.movers]
    .filter((m) => m.clicksDelta > 0)
    .sort((a, b) => b.clicksDelta - a.clicksDelta)
    .slice(0, MOVERS_PER_DIRECTION);

  const fallers = [...trends.movers]
    .filter((m) => m.clicksDelta < 0)
    .sort((a, b) => a.clicksDelta - b.clicksDelta)
    .slice(0, MOVERS_PER_DIRECTION);

  return { risers, fallers, fetchedAt: latest.fetchedAt?.toISOString() ?? null };
}
```

- [ ] **Step 4: Create `app/api/dashboard/gsc-movers/route.ts`**

```ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getGscMovers } from "@/lib/dashboard/gsc-movers";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const result = await getGscMovers();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[dashboard/gsc-movers] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- __tests__/lib/dashboard/gsc-movers.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/gsc-movers.ts app/api/dashboard/gsc-movers/route.ts __tests__/lib/dashboard/gsc-movers.test.ts
git commit -m "feat(dashboard): add gsc-movers endpoint for top GSC risers/fallers widget"
```

---

## Task 3: New `GET /api/dashboard/activity-sparkline` endpoint

**Files:**
- Create: `lib/dashboard/activity-sparkline.ts`
- Create: `app/api/dashboard/activity-sparkline/route.ts`
- Create: `__tests__/lib/dashboard/activity-sparkline.test.ts`

**Interfaces:**
- Produces:
```ts
// GET /api/dashboard/activity-sparkline response
{
  days: Array<{ date: string; count: number }>;  // ISO date string YYYY-MM-DD, last 30 days, oldest first
}
```

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/dashboard/activity-sparkline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  auditLog: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getActivitySparkline } = await import("@/lib/dashboard/activity-sparkline");

beforeEach(() => vi.clearAllMocks());

describe("getActivitySparkline", () => {
  it("returns 30 entries covering the last 30 days", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline();

    expect(result.days).toHaveLength(30);
  });

  it("fills zero for days with no activity", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline();

    expect(result.days.every((d) => d.count === 0)).toBe(true);
  });

  it("counts events correctly per day", async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    mockPrisma.auditLog.findMany.mockResolvedValue([
      { createdAt: today },
      { createdAt: today },
      { createdAt: yesterday },
    ]);

    const result = await getActivitySparkline();

    const todayStr = today.toISOString().slice(0, 10);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const todayEntry = result.days.find((d) => d.date === todayStr);
    const yesterdayEntry = result.days.find((d) => d.date === yesterdayStr);

    expect(todayEntry?.count).toBe(2);
    expect(yesterdayEntry?.count).toBe(1);
  });

  it("returns days in ascending chronological order", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const result = await getActivitySparkline();

    for (let i = 1; i < result.days.length; i++) {
      expect(result.days[i]!.date > result.days[i - 1]!.date).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- __tests__/lib/dashboard/activity-sparkline.test.ts 2>&1 | tail -10
```

Expected: cannot find `@/lib/dashboard/activity-sparkline`.

- [ ] **Step 3: Create `lib/dashboard/activity-sparkline.ts`**

```ts
import { prisma } from "@/lib/db";

const DAYS = 30;

export type SparklineDay = { date: string; count: number };
export type ActivitySparklineResult = { days: SparklineDay[] };

export async function getActivitySparkline(): Promise<ActivitySparklineResult> {
  const since = new Date(Date.now() - DAYS * 24 * 3600_000);

  const entries = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Build a bucket for each of the last 30 days (YYYY-MM-DD in UTC)
  const countByDay = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000);
    countByDay.set(d.toISOString().slice(0, 10), 0);
  }

  for (const e of entries) {
    const key = e.createdAt.toISOString().slice(0, 10);
    if (countByDay.has(key)) {
      countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
    }
  }

  const days: SparklineDay[] = [...countByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return { days };
}
```

- [ ] **Step 4: Create `app/api/dashboard/activity-sparkline/route.ts`**

```ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getActivitySparkline } from "@/lib/dashboard/activity-sparkline";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const result = await getActivitySparkline();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[dashboard/activity-sparkline] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- __tests__/lib/dashboard/activity-sparkline.test.ts 2>&1 | tail -10
```

Expected: all 4 pass.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/activity-sparkline.ts app/api/dashboard/activity-sparkline/route.ts __tests__/lib/dashboard/activity-sparkline.test.ts
git commit -m "feat(dashboard): add activity-sparkline endpoint for 30d AuditLog bar chart"
```

---

## Task 4: New `POST /api/jobs/trigger-job` endpoint

**Files:**
- Create: `app/api/jobs/trigger-job/route.ts`

**Interfaces:**
- Request body: `{ jobName: string }`
- Response: `{ ok: true; jobName: string }` (202) or `{ error: string }` (400/500)
- Implementation: fire-and-forget internal `fetch` to the appropriate cron route using `CRON_SECRET`

The whitelisted jobs and their cron paths:

| jobName | cron path |
|---|---|
| `fetch-ads-data` | `/api/cron/fetch-ads-data` |
| `fetch-seo-data` | `/api/cron/fetch-seo-data` |
| `fetch-gsc-data` | `/api/cron/fetch-gsc-data` |
| `run-skills` | `/api/cron/run-skills` |
| `fetch-market-intel` | `/api/cron/fetch-market-intel` |
| `fetch-keyword-research` | `/api/cron/fetch-keyword-research` |
| `execute-approved` | `/api/cron/execute-approved` |

- [ ] **Step 1: Create `app/api/jobs/trigger-job/route.ts`**

No test needed — this is a thin fire-and-forget wrapper; testing would require mocking `fetch` and the cron routes, adding complexity with no safety payoff.

```ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";

const CRON_JOB_PATHS: Record<string, string> = {
  "fetch-ads-data": "/api/cron/fetch-ads-data",
  "fetch-seo-data": "/api/cron/fetch-seo-data",
  "fetch-gsc-data": "/api/cron/fetch-gsc-data",
  "run-skills": "/api/cron/run-skills",
  "fetch-market-intel": "/api/cron/fetch-market-intel",
  "fetch-keyword-research": "/api/cron/fetch-keyword-research",
  "execute-approved": "/api/cron/execute-approved",
};

export async function POST(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  let body: { jobName?: unknown };
  try {
    body = await req.json() as { jobName?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobName } = body;
  if (typeof jobName !== "string" || !CRON_JOB_PATHS[jobName]) {
    return NextResponse.json(
      { error: `Unknown job: ${String(jobName)}. Valid: ${Object.keys(CRON_JOB_PATHS).join(", ")}` },
      { status: 400 },
    );
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const url = `${origin}${CRON_JOB_PATHS[jobName]}`;

  // Fire and forget — don't await; return 202 immediately
  fetch(url, { headers: { Authorization: `Bearer ${secret}` } }).catch((err) =>
    console.error(`[trigger-job] fire-and-forget failed for ${jobName}:`, err),
  );

  return NextResponse.json({ ok: true, jobName }, { status: 202 });
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "trigger-job"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/jobs/trigger-job/route.ts
git commit -m "feat(dashboard): add trigger-job endpoint for per-job Run Now buttons"
```

---

## Task 5: UI — job health UX, alert banner, stat card links, auto-refresh

**Files:**
- Modify: `app/(embedded)/page.tsx`

This task focuses on operational UX improvements that don't require new data endpoints. All data comes from the already-loaded `DashboardData`.

**Changes:**
1. Top-of-page critical banner if any job has tone `"critical"` (>50h stale)
2. Sort `perJobHealth` by staleness — critical first, then warning, then success
3. Per-job Run Now button inside the expanded `Collapsible` (calls `POST /api/jobs/trigger-job`)
4. Copyable error excerpt (monospace `pre` with a copy button)
5. Auto-refresh every 5 minutes
6. Stat card numbers are wrapped in `Link` to the relevant pilot page

**Pilot page paths** (from `app/(embedded)/` route groups):
- Pending recs → `/recommendations` (or `/ad-pilot` — use whichever actually exists; check `app/(embedded)/`)
- Executed This Month → `/ad-pilot`
- Content Pilot card → `/content-pilot`
- Ad Spend → `/ad-pilot`

Actually, use Next.js `Link` from `next/link`. The embedded app uses relative paths like `/ad-pilot`, `/content-pilot`, etc. Wrap the `Text variant="heading2xl"` numbers in a `<Link href="...">` with `style={{ textDecoration: "none", color: "inherit" }}`.

- [ ] **Step 1: Update `DashboardData` type to include the 7 new fields from Task 1**

In `page.tsx`, update the `DashboardData` interface:

```ts
interface DashboardData {
  pendingCount: number;
  hardBlockedCount: number;
  executedThisMonth: number;
  failedCount: number;
  overrideCount: number;
  lastJobRun: { jobName: string; status: string; startedAt: string; summary: Record<string, unknown> | null } | null;
  perJobHealth: PerJobHealth[];
  contentPilotStats: { pending: number; drafting: number; publishedThisMonth: number };
  adSpendSummary: { current: number; previous: number; delta: number; deltaPct: number | null };
  recsByActionType: Array<{ actionType: string; count: number }>;
  estimatedValueExecuted: number | null;
  latestInsights?: Array<{ insightType: string; skillId: string; createdAt: string; items: unknown[] }>;
  // Task 1 additions:
  openOpportunities?: { high: number; medium: number; low: number };
  openMarketInsights?: { critical: number; warning: number; info: number };
  pendingStoreTasks?: number;
  topPendingRecs?: Array<{
    id: string;
    actionType: string;
    targetEntityName: string;
    rationale: string;
    estimatedImpact: string | null;
    guardStatus: string;
  }>;
  recsPendingOver7Days?: number;
  contentLift?: { count: number; avgLiftPts: number } | null;
  dbLatencyMs?: number;
}
```

- [ ] **Step 2: Add auto-refresh to the `load` callback**

After `useEffect(() => { load(); }, [load]);`, add:

```ts
useEffect(() => {
  const id = setInterval(() => { void load(); }, 5 * 60 * 1000);
  return () => clearInterval(id);
}, [load]);
```

- [ ] **Step 3: Add staleness alert banner**

After the `loadError` banner in the JSX (inside `<Layout>`), add:

```tsx
{(() => {
  const criticalJobs = (data?.perJobHealth ?? []).filter(
    (j) => stalenessTone(j.lastSuccessAt) === "critical" && j.lastSuccessAt !== null,
  );
  const neverRun = (data?.perJobHealth ?? []).filter((j) => j.lastSuccessAt === null);
  if (!data || (criticalJobs.length === 0 && neverRun.length === 0)) return null;
  return (
    <Layout.Section>
      <Banner tone="critical">
        <Text as="p" fontWeight="semibold">
          {criticalJobs.length > 0
            ? `${criticalJobs.length} job${criticalJobs.length !== 1 ? "s" : ""} missed 2+ cycles: ${criticalJobs.map((j) => j.jobName).join(", ")}`
            : `${neverRun.length} job${neverRun.length !== 1 ? "s" : ""} have never run successfully`}
        </Text>
      </Banner>
    </Layout.Section>
  );
})()}
```

- [ ] **Step 4: Sort `perJobHealth` by staleness when rendering**

When mapping `data.perJobHealth` in the Job Health section, sort first:

```tsx
{[...data.perJobHealth]
  .sort((a, b) => {
    const order = { critical: 0, warning: 1, success: 2 };
    return order[stalenessTone(a.lastSuccessAt)] - order[stalenessTone(b.lastSuccessAt)];
  })
  .map((job) => (
    <JobRow key={job.jobName} job={job} history={jobHistory[job.jobName] ?? []} onTrigger={triggerJob} />
  ))}
```

- [ ] **Step 5: Add `triggerJob` function and update `JobRow` to accept + render it**

Add `triggerJob` function near `triggerAll`:

```ts
async function triggerJob(jobName: string) {
  try {
    const res = await authFetch("/api/jobs/trigger-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobName }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      setToast(`Failed to trigger ${jobName}: ${d.error ?? res.status}`);
      return;
    }
    setToast(`${jobName} triggered`);
    setTimeout(() => { void load(); }, 3000);
  } catch (err) {
    setToast(`Error: ${errorMessage(err)}`);
  }
}
```

Update `JobRow` props and component:

```tsx
function JobRow({
  job,
  history,
  onTrigger,
}: {
  job: PerJobHealth;
  history: JobRunEntry[];
  onTrigger: (jobName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // ... existing code ...

  // Inside the Collapsible, add after the existing InlineStack:
  <InlineStack align="space-between" blockAlign="center">
    <Button size="slim" onClick={() => onTrigger(job.jobName)}>
      Run now
    </Button>
  </InlineStack>

  // And for the error excerpt, replace the Banner with:
  {job.errorExcerpt && (
    <BlockStack gap="100">
      <pre
        style={{
          fontFamily: "monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          background: "#fff4f4",
          padding: "8px 12px",
          borderRadius: 4,
          margin: 0,
          maxHeight: 120,
          overflow: "auto",
        }}
      >
        {job.errorExcerpt}
      </pre>
      <Button
        size="slim"
        onClick={() => {
          void navigator.clipboard.writeText(job.errorExcerpt!).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copied!" : "Copy error"}
      </Button>
    </BlockStack>
  )}
```

- [ ] **Step 6: Add `next/link` imports and wrap stat card numbers**

Add to imports at top of file:

```ts
import Link from "next/link";
```

Wrap each big number in the Operations row with a link. Example for Pending:

```tsx
<Link href="/recommendations" style={{ textDecoration: "none", color: "inherit" }}>
  <Text variant="heading2xl" as="p">{data?.pendingCount ?? "—"}</Text>
</Link>
```

Apply same pattern for:
- Executed This Month → `href="/ad-pilot"`
- Failed/Override → `href="/recommendations"`
- Content Pilot numbers → `href="/content-pilot"`
- Ad Spend → `href="/ad-pilot"`

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "page.tsx" | head -10
```

Expected: no errors. Fix any type mismatches (e.g. `onTrigger` prop).

- [ ] **Step 8: Full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add "app/(embedded)/page.tsx"
git commit -m "feat(dashboard): stale job banner, sort by staleness, per-job Run Now, copyable errors, auto-refresh, stat card links"
```

---

## Task 6: UI — Intel section, rec inbox, SkillInsight feed, spend correlation, rec age badge

**Files:**
- Modify: `app/(embedded)/page.tsx`

**New sections to add (between Performance row and Job Health):**

1. **Intel row** — 3 cards: Opportunities (by priority), Market Insights (by severity), Store Tasks + DB latency
2. **Rec inbox** — collapsible card, shows top 5 pending recs, each with Approve / Reject buttons
3. **AI Insights** — SkillInsight feed rendered from `data.latestInsights`
4. **Spend correlation** — inline text in the Ad Spend card: "X actions taken, spend Δ Y"
5. **Rec age badge** — on the "Pending" card: "N pending >7 days" badge in warning tone if > 0

- [ ] **Step 1: Add rec age badge to Pending card**

In the Pending stat card, after the existing `hardBlockedCount` badge:

```tsx
{(data?.recsPendingOver7Days ?? 0) > 0 && (
  <Badge tone="warning">{`${data!.recsPendingOver7Days} stale >7d`}</Badge>
)}
```

- [ ] **Step 2: Add spend correlation text to Ad Spend card**

In the Ad Spend card, after the delta line:

```tsx
{(() => {
  const totalActions = data?.recsByActionType?.reduce((s, r) => s + r.count, 0) ?? 0;
  if (totalActions === 0 || !spend || spend.delta === 0) return null;
  return (
    <Text as="p" tone="subdued">
      {`${totalActions} action${totalActions !== 1 ? "s" : ""} taken this month`}
    </Text>
  );
})()}
```

- [ ] **Step 3: Add Intel row (after Performance row divider)**

Add a new `<Layout.Section>` with three cards:

```tsx
<Layout.Section>
  <BlockStack gap="300">
    <Text variant="headingMd" as="h2">Intel</Text>
    <InlineStack gap="400" wrap={false}>
      {loading ? (
        <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
      ) : (
        <>
          {/* Opportunities */}
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Opportunities</Text>
              {(() => {
                const o = data?.openOpportunities ?? { high: 0, medium: 0, low: 0 };
                const total = o.high + o.medium + o.low;
                if (total === 0) return <Text as="p" tone="subdued">None open</Text>;
                return (
                  <InlineStack gap="300">
                    {o.high > 0 && <Badge tone="critical">{`${o.high} high`}</Badge>}
                    {o.medium > 0 && <Badge tone="warning">{`${o.medium} medium`}</Badge>}
                    {o.low > 0 && <Badge>{`${o.low} low`}</Badge>}
                  </InlineStack>
                );
              })()}
            </BlockStack>
          </Card>

          {/* Market Insights */}
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Market Insights</Text>
              {(() => {
                const mi = data?.openMarketInsights ?? { critical: 0, warning: 0, info: 0 };
                const total = mi.critical + mi.warning + mi.info;
                if (total === 0) return <Text as="p" tone="subdued">No open insights</Text>;
                return (
                  <InlineStack gap="300">
                    {mi.critical > 0 && <Badge tone="critical">{`${mi.critical} critical`}</Badge>}
                    {mi.warning > 0 && <Badge tone="warning">{`${mi.warning} warning`}</Badge>}
                    {mi.info > 0 && <Badge>{`${mi.info} info`}</Badge>}
                  </InlineStack>
                );
              })()}
            </BlockStack>
          </Card>

          {/* Store Tasks + DB Latency */}
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Store Tasks</Text>
              <Text variant="heading2xl" as="p">{data?.pendingStoreTasks ?? "—"}</Text>
              <Text as="p" tone="subdued">pending</Text>
              {data?.dbLatencyMs != null && (
                <Text
                  as="p"
                  tone={data.dbLatencyMs < 100 ? "success" : data.dbLatencyMs < 500 ? undefined : "critical"}
                >
                  DB {data.dbLatencyMs}ms
                </Text>
              )}
            </BlockStack>
          </Card>
        </>
      )}
    </InlineStack>
  </BlockStack>
</Layout.Section>
<Layout.Section><Divider /></Layout.Section>
```

- [ ] **Step 4: Add pending rec inbox (after Intel, before Job Health)**

Add state:

```ts
const [recAction, setRecAction] = useState<Record<string, "approving" | "rejecting" | "done">>({});
```

Add handler functions:

```ts
async function approveRec(id: string) {
  setRecAction((s) => ({ ...s, [id]: "approving" }));
  try {
    const res = await authFetch(`/api/recommendations/${id}/approve`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    setRecAction((s) => ({ ...s, [id]: "done" }));
    void load();
  } catch (err) {
    setToast(`Approve failed: ${errorMessage(err)}`);
    setRecAction((s) => { const n = { ...s }; delete n[id]; return n; });
  }
}

async function rejectRec(id: string) {
  setRecAction((s) => ({ ...s, [id]: "rejecting" }));
  try {
    const res = await authFetch(`/api/recommendations/${id}/reject`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    setRecAction((s) => ({ ...s, [id]: "done" }));
    void load();
  } catch (err) {
    setToast(`Reject failed: ${errorMessage(err)}`);
    setRecAction((s) => { const n = { ...s }; delete n[id]; return n; });
  }
}
```

Add the inbox section:

```tsx
{(data?.topPendingRecs?.length ?? 0) > 0 && (
  <>
    <Layout.Section>
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">
            Pending Review ({data!.pendingCount})
          </Text>
          <BlockStack gap="300">
            {data!.topPendingRecs!.map((rec) => {
              const state = recAction[rec.id];
              if (state === "done") return null;
              return (
                <BlockStack key={rec.id} gap="150">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200">
                        <Text as="p" fontWeight="semibold">{actionLabel(rec.actionType)}</Text>
                        <Text as="p" tone="subdued">—</Text>
                        <Text as="p">{rec.targetEntityName}</Text>
                        {rec.guardStatus !== "clear" && (
                          <Badge tone={rec.guardStatus === "hard_block" ? "critical" : "warning"}>
                            {rec.guardStatus.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="p" tone="subdued">{rec.rationale}</Text>
                      {rec.estimatedImpact && (
                        <Text as="p" tone="subdued">{rec.estimatedImpact}</Text>
                      )}
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button
                        size="slim"
                        variant="primary"
                        loading={state === "approving"}
                        disabled={rec.guardStatus === "hard_block"}
                        onClick={() => approveRec(rec.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="slim"
                        loading={state === "rejecting"}
                        onClick={() => rejectRec(rec.id)}
                      >
                        Reject
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <Divider />
                </BlockStack>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Card>
    </Layout.Section>
    <Layout.Section><Divider /></Layout.Section>
  </>
)}
```

- [ ] **Step 5: Add SkillInsight feed card (after rec inbox, before Job Health)**

```tsx
{(data?.latestInsights?.length ?? 0) > 0 && (
  <>
    <Layout.Section>
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">AI Insights</Text>
          <BlockStack gap="200">
            {data!.latestInsights!.map((insight) => (
              <InlineStack key={insight.insightType} align="space-between">
                <InlineStack gap="200">
                  <Badge>{insight.insightType.replace(/-/g, " ")}</Badge>
                  <Text as="p" tone="subdued">
                    {Array.isArray(insight.items) ? `${insight.items.length} item${insight.items.length !== 1 ? "s" : ""}` : ""}
                  </Text>
                </InlineStack>
                <Text as="p" tone="subdued">{timeAgo(insight.createdAt)}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        </BlockStack>
      </Card>
    </Layout.Section>
    <Layout.Section><Divider /></Layout.Section>
  </>
)}
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "page.tsx" | head -10
```

Expected: no errors. Fix any prop issues.

- [ ] **Step 7: Full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add "app/(embedded)/page.tsx"
git commit -m "feat(dashboard): intel section, rec inbox with inline approve/reject, skill insight feed, spend correlation, rec age badge"
```

---

## Task 7: UI — GSC movers widget + sparklines (activity + ad spend trend)

**Files:**
- Modify: `app/(embedded)/page.tsx`

**New cache keys and fetch logic:**
- `GET /api/dashboard/gsc-movers` → `GscMoversResult`
- `GET /api/dashboard/activity-sparkline` → `{ days: SparklineDay[] }`
- `GET /api/ad-pilot/report` → `{ trend: Array<{ date: string; spend: number; roas: number }> }` (already exists, reuse)

**Sparkline component** — pure CSS, no library. Each bar is a `div` with height proportional to the max value in the series. Maximum height = 40px.

```tsx
function Sparkline({ data, color = "#2c6ecb" }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40 }}>
      {data.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          style={{
            flex: 1,
            height: `${Math.round((v / max) * 40)}px`,
            backgroundColor: v === 0 ? "#e4e5e7" : color,
            borderRadius: 2,
            minHeight: v > 0 ? 2 : 1,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 1: Add new state and fetch calls**

Add state after existing `jobHistory` state:

```ts
const [gscMovers, setGscMovers] = useState<{ risers: GscMover[]; fallers: GscMover[]; fetchedAt: string | null } | null>(
  () => getCache("/api/dashboard/gsc-movers"),
);
const [activityDays, setActivityDays] = useState<Array<{ date: string; count: number }>>(
  () => getCache<{ days: Array<{ date: string; count: number }> }>("/api/dashboard/activity-sparkline")?.days ?? [],
);
const [adTrend, setAdTrend] = useState<Array<{ date: string; spend: number; roas: number }>>(
  () => getCache<{ trend: Array<{ date: string; spend: number; roas: number }> }>("/api/ad-pilot/report")?.trend ?? [],
);
```

Add types at top of file:

```ts
interface GscMover {
  query: string;
  clicks: number;
  clicksDelta: number;
  impressionsDelta: number;
  positionDelta: number;
  direction: "up" | "down";
}
```

Add three new parallel fetch calls inside the `load` function (alongside `historyRequest`):

```ts
const gscMoversRequest = authFetch("/api/dashboard/gsc-movers").then(async (res) => {
  if (!res.ok) return;
  const result = await res.json() as { risers: GscMover[]; fallers: GscMover[]; fetchedAt: string | null };
  setCache("/api/dashboard/gsc-movers", result);
  setGscMovers(result);
}).catch((err) => { console.error("[dashboard] gsc-movers failed:", err); });

const activityRequest = authFetch("/api/dashboard/activity-sparkline").then(async (res) => {
  if (!res.ok) return;
  const result = await res.json() as { days: Array<{ date: string; count: number }> };
  setCache("/api/dashboard/activity-sparkline", result);
  setActivityDays(result.days);
}).catch((err) => { console.error("[dashboard] activity-sparkline failed:", err); });

const adTrendRequest = authFetch("/api/ad-pilot/report").then(async (res) => {
  if (!res.ok) return;
  const result = await res.json() as { trend?: Array<{ date: string; spend: number; roas: number }> };
  if (result.trend) {
    setCache("/api/ad-pilot/report", result);
    setAdTrend(result.trend);
  }
}).catch((err) => { console.error("[dashboard] ad trend failed:", err); });
```

Add the three new requests to `Promise.allSettled`:

```ts
const [statusResult] = await Promise.allSettled([
  statusRequest,
  auditRequest,
  historyRequest,
  gscMoversRequest,
  activityRequest,
  adTrendRequest,
]);
```

- [ ] **Step 2: Add the `Sparkline` component**

Add above `TrendDots`:

```tsx
function Sparkline({ data, color = "#2c6ecb" }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40 }}>
      {data.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          style={{
            flex: 1,
            height: `${Math.round((v / max) * 40)}px`,
            backgroundColor: v === 0 ? "#e4e5e7" : color,
            borderRadius: 2,
            minHeight: v > 0 ? 2 : 1,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add GSC movers card to the Performance row**

Add a 4th card to the Performance row (after Actions This Month):

```tsx
<Card>
  <BlockStack gap="200">
    <Text variant="headingMd" as="h2">GSC Movers</Text>
    {!gscMovers || (gscMovers.risers.length === 0 && gscMovers.fallers.length === 0) ? (
      <Text as="p" tone="subdued">No GSC data yet</Text>
    ) : (
      <BlockStack gap="150">
        {gscMovers.risers.map((m) => (
          <InlineStack key={`r-${m.query}`} align="space-between">
            <Text as="p">{m.query}</Text>
            <Badge tone="success">{`+${m.clicksDelta} clicks`}</Badge>
          </InlineStack>
        ))}
        {gscMovers.fallers.map((m) => (
          <InlineStack key={`f-${m.query}`} align="space-between">
            <Text as="p">{m.query}</Text>
            <Badge tone="critical">{`${m.clicksDelta} clicks`}</Badge>
          </InlineStack>
        ))}
      </BlockStack>
    )}
  </BlockStack>
</Card>
```

- [ ] **Step 4: Add Trends section (before Recent Activity)**

Add a new `Layout.Section` between Job Health and Recent Activity:

```tsx
<Layout.Section>
  <Card>
    <BlockStack gap="400">
      <Text variant="headingMd" as="h2">Trends</Text>
      <InlineStack gap="600" align="start" wrap={false}>
        <BlockStack gap="150">
          <Text as="p" fontWeight="semibold">Activity (30d)</Text>
          {activityDays.length > 0 ? (
            <>
              <Sparkline data={activityDays.map((d) => d.count)} color="#2c6ecb" />
              <Text as="p" tone="subdued">
                {activityDays.reduce((s, d) => s + d.count, 0)} events
              </Text>
            </>
          ) : (
            <Text as="p" tone="subdued">No activity data</Text>
          )}
        </BlockStack>

        <BlockStack gap="150">
          <Text as="p" fontWeight="semibold">Ad Spend trend</Text>
          {adTrend.length > 0 ? (
            <>
              <Sparkline data={adTrend.map((t) => t.spend)} color="#008060" />
              <Text as="p" tone="subdued">
                {`${adTrend.length} snapshots · latest ROAS ${adTrend[adTrend.length - 1]?.roas?.toFixed(2) ?? "—"}x`}
              </Text>
            </>
          ) : (
            <Text as="p" tone="subdued">No ad data</Text>
          )}
        </BlockStack>

        {data?.contentLift && (
          <BlockStack gap="150">
            <Text as="p" fontWeight="semibold">Content SEO lift</Text>
            <Text variant="headingLg" as="p" tone="success">
              {`+${data.contentLift.avgLiftPts.toFixed(1)} pts`}
            </Text>
            <Text as="p" tone="subdued">
              avg across {data.contentLift.count} re-scored article{data.contentLift.count !== 1 ? "s" : ""}
            </Text>
          </BlockStack>
        )}
      </InlineStack>
    </BlockStack>
  </Card>
</Layout.Section>
<Layout.Section><Divider /></Layout.Section>
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "page.tsx" | head -15
```

Expected: no errors. Common fix needed: `tone` prop on `Text` doesn't accept `"success"` in some Polaris versions — use `style={{ color: "#008060" }}` instead if it errors.

- [ ] **Step 6: Full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add "app/(embedded)/page.tsx"
git commit -m "feat(dashboard): GSC movers widget, activity sparkline, ad spend trend sparkline, content SEO lift"
```

---

## Deploy

After all 7 tasks pass tests and are committed:

```bash
node scripts/linode-deploy.mjs
ssh autopilot-prod "cd /opt/autopilot && npm run db:migrate"
```

---

## Self-Review

**Spec coverage:**
- ✅ Open Opportunities by priority — Task 1 + Task 6 Intel section
- ✅ Open Market Insights by severity — Task 1 + Task 6 Intel section
- ✅ Pending Store Tasks count — Task 1 + Task 6 Intel section
- ✅ DB latency — Task 1 (`$queryRaw SELECT 1`) + Task 6 Store Tasks card
- ✅ Top 5 pending recs — Task 1 + Task 6 inbox
- ✅ Recs pending >7 days — Task 1 + Task 5 badge on Pending card
- ✅ Content SEO lift — Task 1 + Task 7 Trends section
- ✅ GSC movers widget — Task 2 + Task 7
- ✅ Activity sparkline — Task 3 + Task 7
- ✅ Per-job Run Now — Task 4 + Task 5
- ✅ Stale job alert banner — Task 5
- ✅ Stat cards link to pilots — Task 5
- ✅ Sort job health by staleness — Task 5
- ✅ Copyable error excerpt — Task 5
- ✅ Auto-refresh every 5min — Task 5
- ✅ Intel section (Opportunities, Market Insights, Store Tasks) — Task 6
- ✅ Inline approve/reject rec inbox — Task 6
- ✅ SkillInsight feed — Task 6
- ✅ Spend vs rec correlation — Task 6
- ✅ Rec age badge — Task 6
- ✅ Ad spend trend sparkline — Task 7

**Placeholder scan:** None found.

**Type consistency:**
- `GscMover` defined in page.tsx matches `QueryMover` from `lib/seo/types.ts` — same fields
- `openOpportunities`, `openMarketInsights`, etc. optional in `DashboardData` (backend may not have them yet on first load from cache) — using `??` fallbacks throughout UI
- `SparklineDay` defined in `lib/dashboard/activity-sparkline.ts`, inlined in page.tsx — consistent
