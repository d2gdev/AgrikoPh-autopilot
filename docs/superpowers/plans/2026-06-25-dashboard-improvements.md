# Dashboard Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Autopilot dashboard with business metric cards (ad spend delta, content pilot stats, rec breakdown + ₱ estimate), richer job health UX (collapsible rows, trend dots, staleness tinting), and loading skeletons throughout.

**Architecture:** Business metrics are added to the existing `buildJobsStatusPayload` query bundle (4 extra parallel Prisma queries). Per-job run history (trend dots) is served by a new lightweight endpoint `/api/dashboard/job-history` fetched in parallel at load time but independently of the main status call. The dashboard UI is a full rewrite of `app/(embedded)/page.tsx` — same file, no new page files.

**Tech Stack:** Next.js 14 App Router, Prisma ORM, Shopify Polaris v12, Vitest, TypeScript strict mode.

## Global Constraints

- All DB access via `import { prisma } from "@/lib/db"` — never `new PrismaClient()`
- Every embedded app API route: `export const dynamic = "force-dynamic"` at top + `await requireAppAuth(req)` as the first statement in every handler
- `AUTOPILOT_API_KEY` is server-side only — never `NEXT_PUBLIC_*`
- `pause_ad` is NOT in `CONVERSION_SENSITIVE_ACTIONS` — do not touch `lib/guardrails.ts`
- Tests use Vitest (`vi.mock`, `describe`, `it`, `expect`, `beforeEach`)
- Path alias `@/` maps to project root — always use it, never relative `../../`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `estimatedValuePhp Float?` to `Recommendation` model |
| `prisma/migrations/YYYYMMDD_add_estimated_value_php/migration.sql` | Create (auto) | Schema migration |
| `lib/dashboard/jobs-status.ts` | Modify | Add 4 new parallel queries + new return fields |
| `lib/dashboard/job-history.ts` | Create | `getJobHistory()` — last 7 runs per job, grouped |
| `app/api/dashboard/job-history/route.ts` | Create | `GET /api/dashboard/job-history` — thin route wrapper |
| `__tests__/lib/dashboard/jobs-status.test.ts` | Create | Unit tests for new payload fields |
| `__tests__/lib/dashboard/job-history.test.ts` | Create | Unit tests for `getJobHistory` |
| `app/(embedded)/page.tsx` | Modify | Full UI rewrite — skeletons, new cards, collapsible job rows |

---

## Task 1: Add `estimatedValuePhp` to Recommendation schema

**Files:**
- Modify: `prisma/schema.prisma` (line 44, after `estimatedImpact String?`)
- Auto-create: `prisma/migrations/`

**Interfaces:**
- Produces: `Recommendation.estimatedValuePhp: Float | null` — used in Task 2 aggregate query

- [ ] **Step 1: Add field to schema**

In `prisma/schema.prisma`, find the `Recommendation` model and add after `estimatedImpact String?`:

```prisma
  estimatedValuePhp  Float?    // numeric ₱ estimate populated by skills; null until skill sets it
```

The block should look like:
```prisma
  rationale        String
  estimatedImpact  String?
  estimatedValuePhp Float?
  confidenceScore  Float?
```

- [ ] **Step 2: Create and apply migration**

```bash
cd /mnt/c/Users/Sean/Documents/Agriko/autopilot-app
npm run db:migrate
```

When prompted for a migration name, enter: `add_estimated_value_php_to_recommendation`

Expected output: `The following migration(s) have been applied: migrations/YYYYMMDDHHMMSS_add_estimated_value_php_to_recommendation/migration.sql`

- [ ] **Step 3: Regenerate Prisma client**

```bash
npm run db:generate
```

Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 4: Verify TypeScript picks up the new field**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors about `estimatedValuePhp`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add estimatedValuePhp to Recommendation"
```

---

## Task 2: Extend `buildJobsStatusPayload` with new metrics

**Files:**
- Modify: `lib/dashboard/jobs-status.ts`
- Create: `__tests__/lib/dashboard/jobs-status.test.ts`

**Interfaces:**
- Consumes: `Recommendation.estimatedValuePhp: Float | null` from Task 1
- Produces: `JobsStatusPayload` extended with:
  ```ts
  contentPilotStats: { pending: number; drafting: number; publishedThisMonth: number }
  adSpendSummary: { current: number; previous: number; delta: number; deltaPct: number | null }
  recsByActionType: Array<{ actionType: string; count: number }>
  estimatedValueExecuted: number | null
  ```

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/dashboard/jobs-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  recommendation: {
    groupBy: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  jobRun: {
    findFirst: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  contentProposal: {
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  rawSnapshot: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { buildJobsStatusPayload } = await import("@/lib/dashboard/jobs-status");

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults for all existing queries
  mockPrisma.recommendation.groupBy.mockResolvedValue([
    { status: "pending", _count: { _all: 3 } },
    { status: "executed", _count: { _all: 10 } },
  ]);
  mockPrisma.recommendation.count.mockResolvedValue(1);
  mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: 4500 } });
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.groupBy.mockResolvedValue([]);
  mockPrisma.jobRun.findMany.mockResolvedValue([]);
  mockPrisma.contentProposal.groupBy.mockResolvedValue([
    { status: "pending", _count: { _all: 2 } },
  ]);
  mockPrisma.contentProposal.count.mockResolvedValue(5);
  mockPrisma.rawSnapshot.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findUnique.mockResolvedValue(null);
});

describe("buildJobsStatusPayload", () => {
  it("returns contentPilotStats with pending and publishedThisMonth counts", async () => {
    mockPrisma.contentProposal.groupBy.mockResolvedValue([
      { status: "pending", _count: { _all: 4 } },
      { status: "approved", _count: { _all: 1 } },
    ]);
    mockPrisma.contentProposal.count.mockResolvedValue(3); // publishedThisMonth

    const result = await buildJobsStatusPayload();

    expect(result.contentPilotStats.pending).toBe(4);
    expect(result.contentPilotStats.publishedThisMonth).toBe(3);
  });

  it("returns adSpendSummary with delta from two most recent Meta snapshots", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([
      {
        payload: {
          insights: [
            { spend: "100.00", clicks: 50, impressions: 1000, actions: [], action_values: [] },
            { spend: "50.00", clicks: 20, impressions: 500, actions: [], action_values: [] },
          ],
        },
      },
      {
        payload: {
          insights: [
            { spend: "80.00", clicks: 40, impressions: 900, actions: [], action_values: [] },
          ],
        },
      },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.adSpendSummary.current).toBeCloseTo(150);
    expect(result.adSpendSummary.previous).toBeCloseTo(80);
    expect(result.adSpendSummary.delta).toBeCloseTo(70);
    expect(result.adSpendSummary.deltaPct).toBeCloseTo(87.5);
  });

  it("returns adSpendSummary with nulls when no Meta snapshots exist", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([]);

    const result = await buildJobsStatusPayload();

    expect(result.adSpendSummary.current).toBe(0);
    expect(result.adSpendSummary.previous).toBe(0);
    expect(result.adSpendSummary.delta).toBe(0);
    expect(result.adSpendSummary.deltaPct).toBeNull();
  });

  it("returns recsByActionType for executed recs this month", async () => {
    // Second groupBy call is the actionType groupBy (first is status)
    mockPrisma.recommendation.groupBy
      .mockResolvedValueOnce([{ status: "pending", _count: { _all: 1 } }])
      .mockResolvedValueOnce([
        { actionType: "pause_campaign", _count: { _all: 3 } },
        { actionType: "change_bid", _count: { _all: 2 } },
      ]);

    const result = await buildJobsStatusPayload();

    expect(result.recsByActionType).toEqual(
      expect.arrayContaining([
        { actionType: "pause_campaign", count: 3 },
        { actionType: "change_bid", count: 2 },
      ]),
    );
  });

  it("returns estimatedValueExecuted as null when no recs have the field set", async () => {
    mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: null } });

    const result = await buildJobsStatusPayload();

    expect(result.estimatedValueExecuted).toBeNull();
  });

  it("returns estimatedValueExecuted sum when values exist", async () => {
    mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: 4500 } });

    const result = await buildJobsStatusPayload();

    expect(result.estimatedValueExecuted).toBe(4500);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- __tests__/lib/dashboard/jobs-status.test.ts 2>&1 | tail -20
```

Expected: failures referencing `contentPilotStats`, `adSpendSummary`, etc. not in payload.

- [ ] **Step 3: Update `JobsStatusPayload` type and `buildJobsStatusPayload`**

In `lib/dashboard/jobs-status.ts`, replace the `JobsStatusPayload` type definition and `buildJobsStatusPayload` function:

**Updated type** (add after the existing fields):
```ts
export type JobsStatusPayload = {
  pendingCount: number;
  hardBlockedCount: number;
  executedThisMonth: number;
  failedCount: number;
  overrideCount: number;
  lastJobRun: Record<string, unknown> | null;
  perJobHealth: Array<Record<string, unknown>>;
  staleRunning: {
    thresholdMinutes: number;
    count: number;
    sample: Array<Record<string, unknown>>;
  };
  contentPilotStats: {
    pending: number;
    drafting: number;
    publishedThisMonth: number;
  };
  adSpendSummary: {
    current: number;
    previous: number;
    delta: number;
    deltaPct: number | null;
  };
  recsByActionType: Array<{ actionType: string; count: number }>;
  estimatedValueExecuted: number | null;
};
```

**Updated `buildJobsStatusPayload`** — add 4 new queries to the existing `Promise.all` and add import for `addInsightRow`/`emptyMetrics` at the top of the file:

At the top of `lib/dashboard/jobs-status.ts`, add import:
```ts
import { addInsightRow, emptyMetrics } from "@/lib/ad-pilot/report";
```

Inside `buildJobsStatusPayload`, extend the `Promise.all` by adding these 4 new entries alongside the existing 9:

```ts
export async function buildJobsStatusPayload(): Promise<JobsStatusPayload> {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const staleRunningBefore = new Date(Date.now() - STALE_RUNNING_JOB_MINUTES * 60_000);

  const [
    recommendationStatusCounts,
    hardBlockedCount,
    executedThisMonth,
    lastJobRun,
    lastRunGroups,
    lastSuccessGroups,
    queuedGroups,
    staleRunningGroups,
    staleRunningRuns,
    // --- new ---
    contentProposalGroups,
    contentPublishedThisMonth,
    metaSnapshots,
    recActionTypeGroups,
    estimatedValueAgg,
  ] = await Promise.all([
    // --- existing 9 queries unchanged ---
    prisma.recommendation.groupBy({
      by: ["status"],
      where: { status: { in: ["pending", "failed", "override_approved", "approved", "executing"] } },
      _count: { _all: true },
    }),
    prisma.recommendation.count({ where: { guardStatus: "hard_block", status: "pending" } }),
    prisma.recommendation.count({ where: { status: "executed", executedAt: { gte: monthStart } } }),
    prisma.jobRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { jobName: true, status: true, startedAt: true, summary: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: { jobName: { in: JOB_NAMES } },
      _max: { startedAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: {
        jobName: { in: JOB_NAMES },
        status: { in: ["success", "partial"] },
        completedAt: { not: null },
      },
      _max: { completedAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: { jobName: { in: JOB_NAMES }, status: "queued" },
      _count: { _all: true },
      _min: { startedAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["jobName"],
      where: {
        jobName: { in: JOB_NAMES },
        status: "running",
        startedAt: { lt: staleRunningBefore },
      },
      _count: { _all: true },
      _min: { startedAt: true },
    }),
    prisma.jobRun.findMany({
      where: {
        jobName: { in: JOB_NAMES },
        status: "running",
        startedAt: { lt: staleRunningBefore },
      },
      orderBy: { startedAt: "asc" },
      take: 10,
      select: { id: true, jobName: true, startedAt: true },
    }),
    // --- 4 new queries ---
    prisma.contentProposal.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.contentProposal.count({
      where: { publishedAt: { gte: monthStart } },
    }),
    prisma.rawSnapshot.findMany({
      where: { source: "meta" },
      orderBy: { fetchedAt: "desc" },
      take: 2,
      select: { payload: true },
    }),
    prisma.recommendation.groupBy({
      by: ["actionType"],
      where: { status: "executed", executedAt: { gte: monthStart } },
      _count: { _all: true },
    }),
    prisma.recommendation.aggregate({
      where: { status: "executed", executedAt: { gte: monthStart } },
      _sum: { estimatedValuePhp: true },
    }),
  ]);

  // --- existing processing unchanged (countByStatus, perJobHealth, etc.) ---
  const countByStatus = new Map(
    recommendationStatusCounts.map((row) => [row.status, row._count._all]),
  );
  const pendingCount = countByStatus.get("pending") ?? 0;
  const failedCount = countByStatus.get("failed") ?? 0;
  const overrideCount = countByStatus.get("override_approved") ?? 0;

  const latestRunFilters = lastRunGroups
    .flatMap((row) => row._max.startedAt ? [{ jobName: row.jobName, startedAt: row._max.startedAt }] : []);
  const latestRuns = latestRunFilters.length > 0
    ? await prisma.jobRun.findMany({
        where: { OR: latestRunFilters },
        select: { jobName: true, status: true, startedAt: true, errorLog: true },
      })
    : [];

  const lastRunByJob = new Map<string, typeof latestRuns[number]>();
  for (const run of latestRuns) {
    const existing = lastRunByJob.get(run.jobName);
    if (!existing || run.startedAt > existing.startedAt) {
      lastRunByJob.set(run.jobName, run);
    }
  }

  const lastSuccessByJob = new Map(
    lastSuccessGroups.map((row) => [row.jobName, row._max.completedAt]),
  );
  const queuedByJob = new Map(
    queuedGroups.map((row) => [row.jobName, { count: row._count._all, oldestQueuedAt: row._min.startedAt }]),
  );
  const staleRunningByJob = new Map(
    staleRunningGroups.map((row) => [row.jobName, { count: row._count._all, oldestStartedAt: row._min.startedAt }]),
  );
  const staleRunningCount = staleRunningGroups.reduce((sum, row) => sum + row._count._all, 0);

  const perJobHealth = JOB_NAMES.map((jobName) => {
    const last = lastRunByJob.get(jobName);
    const queued = queuedByJob.get(jobName);
    const stale = staleRunningByJob.get(jobName);
    return {
      jobName,
      lastStatus: last?.status ?? null,
      lastStartedAt: last?.startedAt ?? null,
      lastSuccessAt: lastSuccessByJob.get(jobName) ?? null,
      queuedCount: queued?.count ?? 0,
      oldestQueuedAt: queued?.oldestQueuedAt ?? null,
      staleRunningCount: stale?.count ?? 0,
      oldestStaleRunningStartedAt: stale?.oldestStartedAt ?? null,
      errorExcerpt:
        last?.status && !["success", "running", "queued"].includes(last.status)
          ? (last.errorLog ?? "").slice(0, 300)
          : null,
    };
  });

  // --- new: content pilot stats ---
  const proposalCountByStatus = new Map(
    contentProposalGroups.map((row) => [row.status, row._count._all]),
  );
  const contentPilotStats = {
    pending: proposalCountByStatus.get("pending") ?? 0,
    drafting: proposalCountByStatus.get("approved") ?? 0,
    publishedThisMonth: contentPublishedThisMonth,
  };

  // --- new: ad spend summary (latest 2 Meta snapshots) ---
  function sumSpendFromSnapshot(snap: { payload: unknown } | undefined): number {
    if (!snap) return 0;
    const p = snap.payload as Record<string, unknown>;
    const insights = (p.insights as Array<Record<string, unknown>>) ?? [];
    const m = emptyMetrics();
    for (const row of insights) addInsightRow(m, row);
    return m.spend;
  }
  const currentSpend = sumSpendFromSnapshot(metaSnapshots[0]);
  const previousSpend = sumSpendFromSnapshot(metaSnapshots[1]);
  const spendDelta = currentSpend - previousSpend;
  const adSpendSummary = {
    current: currentSpend,
    previous: previousSpend,
    delta: spendDelta,
    deltaPct: previousSpend > 0 ? (spendDelta / previousSpend) * 100 : null,
  };

  // --- new: recs by action type ---
  const recsByActionType = recActionTypeGroups.map((row) => ({
    actionType: row.actionType,
    count: row._count._all,
  }));

  // --- new: estimated value executed ---
  const estimatedValueExecuted = estimatedValueAgg._sum.estimatedValuePhp ?? null;

  return {
    pendingCount,
    hardBlockedCount,
    executedThisMonth,
    failedCount,
    overrideCount,
    lastJobRun,
    perJobHealth,
    staleRunning: {
      thresholdMinutes: STALE_RUNNING_JOB_MINUTES,
      count: staleRunningCount,
      sample: staleRunningRuns,
    },
    contentPilotStats,
    adSpendSummary,
    recsByActionType,
    estimatedValueExecuted,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- __tests__/lib/dashboard/jobs-status.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -30
```

Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/jobs-status.ts __tests__/lib/dashboard/jobs-status.test.ts
git commit -m "feat(dashboard): extend buildJobsStatusPayload with content pilot, ad spend, rec breakdown metrics"
```

---

## Task 3: New `GET /api/dashboard/job-history` endpoint

**Files:**
- Create: `lib/dashboard/job-history.ts`
- Create: `app/api/dashboard/job-history/route.ts`
- Create: `__tests__/lib/dashboard/job-history.test.ts`

**Interfaces:**
- Consumes: `JOB_NAMES` constant from `lib/dashboard/jobs-status.ts`
- Produces:
  ```ts
  // GET /api/dashboard/job-history response
  {
    history: Record<string, Array<{ status: string; startedAt: string }>>
  }
  // history keys = jobName; array is newest-first, max 7 entries per job
  ```

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/dashboard/job-history.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  jobRun: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getJobHistory } = await import("@/lib/dashboard/job-history");

beforeEach(() => vi.clearAllMocks());

describe("getJobHistory", () => {
  it("returns last 7 runs per job, newest-first, keyed by jobName", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValue([
      { jobName: "fetch-ads-data", status: "success", startedAt: new Date("2026-06-25T10:00:00Z") },
      { jobName: "fetch-ads-data", status: "failed", startedAt: new Date("2026-06-24T10:00:00Z") },
      { jobName: "run-skills", status: "success", startedAt: new Date("2026-06-25T11:00:00Z") },
    ]);

    const result = await getJobHistory();

    expect(result["fetch-ads-data"]).toHaveLength(2);
    expect(result["fetch-ads-data"]![0]!.status).toBe("success");
    expect(result["fetch-ads-data"]![1]!.status).toBe("failed");
    expect(result["run-skills"]).toHaveLength(1);
    expect(result["run-skills"]![0]!.status).toBe("success");
  });

  it("returns empty arrays for jobs with no runs", async () => {
    mockPrisma.jobRun.findMany.mockResolvedValue([]);

    const result = await getJobHistory();

    expect(Object.values(result).every((arr) => arr.length === 0)).toBe(true);
  });

  it("limits each job to 7 entries even if DB returns more", async () => {
    const manyRuns = Array.from({ length: 10 }, (_, i) => ({
      jobName: "run-skills",
      status: "success",
      startedAt: new Date(Date.now() - i * 86400000),
    }));
    mockPrisma.jobRun.findMany.mockResolvedValue(manyRuns);

    const result = await getJobHistory();

    expect(result["run-skills"]!.length).toBeLessThanOrEqual(7);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- __tests__/lib/dashboard/job-history.test.ts 2>&1 | tail -15
```

Expected: module not found for `@/lib/dashboard/job-history`.

- [ ] **Step 3: Create `lib/dashboard/job-history.ts`**

```ts
import { prisma } from "@/lib/db";
import { JOB_NAMES } from "@/lib/dashboard/jobs-status";

const HISTORY_PER_JOB = 7;

export type JobRunEntry = {
  status: string;
  startedAt: string;
};

export type JobHistoryMap = Record<string, JobRunEntry[]>;

export async function getJobHistory(): Promise<JobHistoryMap> {
  const runs = await prisma.jobRun.findMany({
    where: { jobName: { in: JOB_NAMES } },
    orderBy: { startedAt: "desc" },
    take: JOB_NAMES.length * HISTORY_PER_JOB,
    select: { jobName: true, status: true, startedAt: true },
  });

  const result: JobHistoryMap = Object.fromEntries(JOB_NAMES.map((name) => [name, []]));

  for (const run of runs) {
    const bucket = result[run.jobName];
    if (bucket && bucket.length < HISTORY_PER_JOB) {
      bucket.push({ status: run.status, startedAt: run.startedAt.toISOString() });
    }
  }

  return result;
}
```

Note: `JOB_NAMES` must be exported from `lib/dashboard/jobs-status.ts`. If it isn't already, change `const JOB_NAMES` to `export const JOB_NAMES` in that file.

- [ ] **Step 4: Create `app/api/dashboard/job-history/route.ts`**

```ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { getJobHistory } from "@/lib/dashboard/job-history";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const history = await getJobHistory();
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[dashboard/job-history] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- __tests__/lib/dashboard/job-history.test.ts 2>&1 | tail -15
```

Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/jobs-status.ts lib/dashboard/job-history.ts app/api/dashboard/job-history/route.ts __tests__/lib/dashboard/job-history.test.ts
git commit -m "feat(dashboard): add job history endpoint for trend dots"
```

---

## Task 4: Rewrite dashboard UI

**Files:**
- Modify: `app/(embedded)/page.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/jobs/status` → `DashboardData` (extended with new fields from Task 2)
  - `GET /api/dashboard/job-history` → `{ history: JobHistoryMap }`
- Produces: updated dashboard page with skeletons, new cards, collapsible job rows

**Staleness thresholds** (daily cron = 24h cycle):
- `< 26h` since last success → green (on track)
- `26–50h` → amber (one cycle missed)
- `> 50h` → red (two+ cycles missed)
- `null` (never succeeded) → red

**Trend dot colours by status:**
- `success` → green (`#008060`)
- `partial` → amber (`#ffc453`)
- `failed` → red (`#d72c0d`)
- `queued` / `running` → blue (`#2c6ecb`)
- anything else / null → grey (`#8c9196`)

- [ ] **Step 1: Rewrite `app/(embedded)/page.tsx`**

Replace the entire file with:

```tsx
"use client";

import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Badge,
  Banner,
  InlineStack,
  BlockStack,
  Divider,
  Toast,
  SkeletonDisplayText,
  SkeletonBodyText,
  Box,
  Collapsible,
} from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { getCache, setCache } from "@/lib/client-cache";

// ── Types ────────────────────────────────────────────────────────────────────

interface PerJobHealth {
  jobName: string;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  queuedCount?: number;
  oldestQueuedAt?: string | null;
  errorExcerpt: string | null;
}

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
}

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  after: Record<string, unknown> | null;
}

interface AuditLogResponse {
  items?: AuditEntry[];
  logs?: AuditEntry[];
}

type JobHistoryMap = Record<string, Array<{ status: string; startedAt: string }>>;

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_STATUS_CACHE_KEY = "/api/jobs/status";
const AUDIT_LOG_CACHE_KEY = "/api/audit-log?limit=10";
const JOB_HISTORY_CACHE_KEY = "/api/dashboard/job-history";

const STATUS_DOT_COLOR: Record<string, string> = {
  success: "#008060",
  partial: "#ffc453",
  failed: "#d72c0d",
  queued: "#2c6ecb",
  running: "#2c6ecb",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function stalenessTone(lastSuccessAt: string | null): "success" | "warning" | "critical" {
  if (!lastSuccessAt) return "critical";
  const hrs = (Date.now() - new Date(lastSuccessAt).getTime()) / 3600000;
  if (hrs < 26) return "success";
  if (hrs < 50) return "warning";
  return "critical";
}

function stalenessBackground(tone: "success" | "warning" | "critical"): string {
  if (tone === "success") return "bg-surface-success";
  if (tone === "warning") return "bg-surface-caution";
  return "bg-surface-critical";
}

function actionLabel(action: string) {
  return action.replace(/_/g, " ");
}

function formatPhp(value: number | null): string {
  if (value === null) return "—";
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatSpend(value: number): string {
  if (value === 0) return "—";
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function responseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({})) as { error?: unknown };
  return typeof data.error === "string" ? data.error : `${fallback} (${res.status})`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TrendDots({ runs }: { runs: Array<{ status: string; startedAt: string }> }) {
  if (runs.length === 0) return <Text as="span" tone="subdued">no history</Text>;
  return (
    <InlineStack gap="100" blockAlign="center">
      {[...runs].reverse().map((run, i) => (
        <span
          key={i}
          title={`${run.status} — ${timeAgo(run.startedAt)}`}
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: STATUS_DOT_COLOR[run.status] ?? "#8c9196",
          }}
        />
      ))}
    </InlineStack>
  );
}

interface JobRowProps {
  job: PerJobHealth;
  history: Array<{ status: string; startedAt: string }>;
}

function JobRow({ job, history }: JobRowProps) {
  const [open, setOpen] = useState(false);
  const tone = stalenessTone(job.lastSuccessAt);
  const bg = stalenessBackground(tone);

  const statusTone =
    job.lastStatus === "success" ? "success"
    : job.lastStatus === "partial" ? "warning"
    : job.lastStatus === "failed" ? "critical"
    : job.lastStatus === "queued" || (job.queuedCount ?? 0) > 0 ? "info"
    : "new";

  return (
    <Box
      background={bg as Parameters<typeof Box>[0]["background"]}
      padding="300"
      borderRadius="200"
    >
      <BlockStack gap="200">
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}
          aria-expanded={open}
        >
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              <Text as="p" fontWeight="semibold">{job.jobName}</Text>
              <Badge tone={statusTone as "success" | "warning" | "critical" | "new" | "info"}>
                {job.lastStatus ?? "never run"}
              </Badge>
              <TrendDots runs={history} />
            </InlineStack>
            <InlineStack gap="400" blockAlign="center">
              {(job.queuedCount ?? 0) > 0 && (
                <Text as="p" tone="subdued">Queued: {job.queuedCount}</Text>
              )}
              <Text as="p" tone="subdued">
                {job.lastStartedAt ? timeAgo(job.lastStartedAt) : "Never run"}
              </Text>
              <Text as="p" tone="subdued">{open ? "▲" : "▼"}</Text>
            </InlineStack>
          </InlineStack>
        </button>

        <Collapsible id={`job-${job.jobName}`} open={open}>
          <BlockStack gap="200">
            <InlineStack gap="400">
              <Text as="p" tone="subdued">
                Last success: {job.lastSuccessAt ? timeAgo(job.lastSuccessAt) : "never"}
              </Text>
              {job.lastStartedAt && (
                <Text as="p" tone="subdued">
                  Last run: {new Date(job.lastStartedAt).toLocaleString()}
                </Text>
              )}
            </InlineStack>
            {job.errorExcerpt && (
              <Banner tone="critical">
                <Text as="p">{job.errorExcerpt}</Text>
              </Banner>
            )}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Box>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <Card>
      <BlockStack gap="200">
        <SkeletonDisplayText size="small" />
        <SkeletonDisplayText size="large" />
      </BlockStack>
    </Card>
  );
}

function JobHealthSkeleton() {
  return (
    <BlockStack gap="200">
      {Array.from({ length: 5 }).map((_, i) => (
        <Box key={i} padding="300" borderRadius="200" background="bg-surface-secondary">
          <SkeletonBodyText lines={1} />
        </Box>
      ))}
    </BlockStack>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<DashboardData | null>(() => getCache<DashboardData>(JOB_STATUS_CACHE_KEY));
  const [logs, setLogs] = useState<AuditEntry[]>(() => getCache<AuditEntry[]>(AUDIT_LOG_CACHE_KEY) ?? []);
  const [jobHistory, setJobHistory] = useState<JobHistoryMap>(() => getCache<JobHistoryMap>(JOB_HISTORY_CACHE_KEY) ?? {});
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!data);

  const load = useCallback(async () => {
    setLoadError(null);

    const statusRequest = authFetch(JOB_STATUS_CACHE_KEY).then(async (res) => {
      if (!res.ok) throw new Error(await responseError(res, "Status request failed"));
      const nextData = await res.json() as DashboardData;
      setCache(JOB_STATUS_CACHE_KEY, nextData);
      setData(nextData);
    });

    const auditRequest = authFetch(AUDIT_LOG_CACHE_KEY).then(async (res) => {
      if (!res.ok) throw new Error(await responseError(res, "Activity request failed"));
      const result = await res.json() as AuditLogResponse;
      const nextLogs = result.items ?? result.logs ?? [];
      setCache(AUDIT_LOG_CACHE_KEY, nextLogs);
      setLogs(nextLogs);
    }).catch((err) => { console.error("[dashboard] audit log load failed:", err); });

    const historyRequest = authFetch(JOB_HISTORY_CACHE_KEY).then(async (res) => {
      if (!res.ok) return;
      const result = await res.json() as { history: JobHistoryMap };
      setCache(JOB_HISTORY_CACHE_KEY, result.history);
      setJobHistory(result.history);
    }).catch((err) => { console.error("[dashboard] job history load failed:", err); });

    const [statusResult] = await Promise.allSettled([statusRequest, auditRequest, historyRequest]);
    if (statusResult.status === "rejected") {
      setLoadError(errorMessage(statusResult.reason));
    }
    setLoading(false);
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  async function triggerAll() {
    setTriggering(true);
    try {
      const res = await authFetch("/api/jobs/trigger", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoadError(d.error ?? `Trigger failed (${res.status})`);
        return;
      }
      const d = await res.json() as { queued?: boolean; newRecs?: number };
      void load();
      setToast(d.queued
        ? "Dashboard refresh queued"
        : (d.newRecs ?? 0) > 0
          ? `${d.newRecs!} new recommendation${d.newRecs !== 1 ? "s" : ""} generated`
          : "Analysis complete — no new recommendations");
    } finally {
      setTriggering(false);
    }
  }

  const spendDeltaSign = (data?.adSpendSummary.delta ?? 0) >= 0 ? "+" : "";
  const spendDeltaPct = data?.adSpendSummary.deltaPct;

  return (
    <>
      <Page
        title="Autopilot Dashboard"
        primaryAction={
          <Button onClick={triggerAll} loading={triggering} variant="primary">
            Run Now
          </Button>
        }
      >
        <Layout>
          {loadError && (
            <Layout.Section>
              <Banner tone="critical" onDismiss={() => setLoadError(null)}>
                Failed to load dashboard data: {loadError}
              </Banner>
            </Layout.Section>
          )}

          {/* ── Row 1: Operational stats ── */}
          <Layout.Section>
            <Text variant="headingMd" as="h2">Operations</Text>
          </Layout.Section>
          <Layout.Section>
            <InlineStack gap="400" wrap={false}>
              {loading ? (
                <>
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                </>
              ) : (
                <>
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Pending</Text>
                      <Text variant="heading2xl" as="p">{data?.pendingCount ?? "—"}</Text>
                      {(data?.hardBlockedCount ?? 0) > 0 && (
                        <Badge tone="critical">{data!.hardBlockedCount} hard blocked</Badge>
                      )}
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Executed This Month</Text>
                      <Text variant="heading2xl" as="p">{data?.executedThisMonth ?? "—"}</Text>
                      {data?.estimatedValueExecuted != null && (
                        <Text as="p" tone="subdued">
                          est. {formatPhp(data.estimatedValueExecuted)} impact
                        </Text>
                      )}
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Failed / Override</Text>
                      <InlineStack gap="300" blockAlign="end">
                        <Text variant="heading2xl" as="p">{data?.failedCount ?? "—"}</Text>
                        <Text as="p" tone="subdued">/ {data?.overrideCount ?? "—"}</Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Last Job Run</Text>
                      {data?.lastJobRun ? (
                        <BlockStack gap="100">
                          <Text as="p">{data.lastJobRun.jobName.replace(/-/g, " ")}</Text>
                          <Badge
                            tone={data.lastJobRun.status === "success" || data.lastJobRun.status === "partial" ? "success" : "critical"}
                          >
                            {data.lastJobRun.status}
                          </Badge>
                          <Text as="p" tone="subdued">{timeAgo(data.lastJobRun.startedAt)}</Text>
                        </BlockStack>
                      ) : (
                        <Text as="p" tone="subdued">Never run</Text>
                      )}
                    </BlockStack>
                  </Card>
                </>
              )}
            </InlineStack>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Row 2: Business metrics ── */}
          <Layout.Section>
            <Text variant="headingMd" as="h2">Performance</Text>
          </Layout.Section>
          <Layout.Section>
            <InlineStack gap="400" wrap={false}>
              {loading ? (
                <>
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                </>
              ) : (
                <>
                  {/* Ad Spend */}
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Ad Spend (Latest)</Text>
                      <Text variant="heading2xl" as="p">
                        {formatSpend(data?.adSpendSummary.current ?? 0)}
                      </Text>
                      {data?.adSpendSummary && data.adSpendSummary.previous > 0 && (
                        <Text as="p" tone={data.adSpendSummary.delta <= 0 ? "success" : "critical"}>
                          {spendDeltaSign}{formatSpend(data.adSpendSummary.delta)}
                          {spendDeltaPct != null && ` (${spendDeltaSign}${spendDeltaPct.toFixed(1)}%)`}
                          {" vs prior"}
                        </Text>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Content Pilot */}
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Content Pilot</Text>
                      <InlineStack gap="400">
                        <BlockStack gap="100">
                          <Text variant="heading2xl" as="p">{data?.contentPilotStats.pending ?? "—"}</Text>
                          <Text as="p" tone="subdued">pending</Text>
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text variant="heading2xl" as="p">{data?.contentPilotStats.drafting ?? "—"}</Text>
                          <Text as="p" tone="subdued">drafting</Text>
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text variant="heading2xl" as="p">{data?.contentPilotStats.publishedThisMonth ?? "—"}</Text>
                          <Text as="p" tone="subdued">published</Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>

                  {/* Rec breakdown */}
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h2">Actions This Month</Text>
                      {!data?.recsByActionType || data.recsByActionType.length === 0 ? (
                        <Text as="p" tone="subdued">None yet</Text>
                      ) : (
                        <BlockStack gap="100">
                          {data.recsByActionType.map((r) => (
                            <InlineStack key={r.actionType} align="space-between">
                              <Text as="p">{actionLabel(r.actionType)}</Text>
                              <Badge>{String(r.count)}</Badge>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      )}
                    </BlockStack>
                  </Card>
                </>
              )}
            </InlineStack>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Job Health ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Job Health</Text>
                <Text as="p" tone="subdued">
                  Row colour: green = on track, amber = one cycle missed (&gt;26h), red = two+ cycles missed (&gt;50h). Dots = last 7 runs.
                </Text>
                {loading ? (
                  <JobHealthSkeleton />
                ) : !data?.perJobHealth || data.perJobHealth.length === 0 ? (
                  <Text as="p" tone="subdued">No job history yet.</Text>
                ) : (
                  <BlockStack gap="200">
                    {data.perJobHealth.map((job) => (
                      <JobRow
                        key={job.jobName}
                        job={job}
                        history={jobHistory[job.jobName] ?? []}
                      />
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section><Divider /></Layout.Section>

          {/* ── Recent Activity ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Recent Activity</Text>
                {logs.length === 0 ? (
                  <Text as="p" tone="subdued">No activity yet. Click Run Now to start.</Text>
                ) : (
                  <BlockStack gap="200">
                    {logs.slice(0, 10).map((log) => (
                      <InlineStack key={log.id} align="space-between">
                        <InlineStack gap="200">
                          <Badge tone={log.actor === "user" ? "info" : "new"}>{log.actor}</Badge>
                          <Text as="p">{actionLabel(log.action)}</Text>
                          <Text as="p" tone="subdued">{log.entityType}</Text>
                        </InlineStack>
                        <Text as="p" tone="subdued">{timeAgo(log.createdAt)}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "page.tsx"
```

Expected: no errors for `page.tsx`. Fix any reported issues (likely `Box` `background` prop types — use `"bg-surface-secondary"` literals as Polaris requires).

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Start dev server and manually verify**

```bash
npm run dev
```

Open the app in Shopify admin. Verify:
- Loading skeletons appear briefly on first load
- Operations row shows 4 stat cards
- Performance row shows Ad Spend, Content Pilot, Actions This Month
- Job Health rows are colour-tinted by staleness
- Each job row has trend dots (coloured circles)
- Clicking a row expands to show error details + last run timestamp
- Run Now button still works

- [ ] **Step 5: Commit**

```bash
git add app/\(embedded\)/page.tsx
git commit -m "feat(dashboard): new metric cards, collapsible job rows with trend dots and staleness tinting, loading skeletons"
```

---

## Self-Review

**Spec coverage:**
- ✅ (A) Execution breakdown by action type — `recsByActionType` card
- ✅ (B) `estimatedValuePhp` schema field + aggregate sum on executed card
- ✅ (C) Ad spend delta from Meta snapshots — `adSpendSummary` card
- ✅ Content pilot stats — `contentPilotStats` card
- ✅ Collapsible job rows — `Collapsible` + expand button
- ✅ Trend dots — `TrendDots` component, last 7 runs per job
- ✅ Staleness warnings — `stalenessTone` → background tint + legend
- ✅ Loading skeletons — `StatCardSkeleton`, `JobHealthSkeleton`
- ✅ Layout/visual overhaul — two-row card layout, section headers

**Placeholder scan:** None found.

**Type consistency:**
- `JobHistoryMap = Record<string, Array<{ status: string; startedAt: string }>>` — defined once, used in lib, route, and page
- `DashboardData` in page extends the fields produced by `buildJobsStatusPayload`
- `JOB_NAMES` exported from `jobs-status.ts`, imported in `job-history.ts`
