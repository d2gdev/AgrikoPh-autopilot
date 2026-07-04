import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  recommendation: {
    groupBy: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
  jobRun: {
    findFirst: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  contentProposal: {
    groupBy: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
  rawSnapshot: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  opportunity: { groupBy: vi.fn() },
  marketInsight: { groupBy: vi.fn() },
  storeTask: { count: vi.fn() },
  skillInsight: { groupBy: vi.fn(), findMany: vi.fn() },
  dailySales: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { buildJobsStatusPayload, getJobsStatusPayload } = await import("@/lib/dashboard/jobs-status");

function snapshotPayload(overrides: Record<string, unknown> = {}) {
  return {
    computedAt: "2026-06-25T00:00:00.000Z",
    fromSnapshot: false,
    snapshotAgeMs: null,
    buildDurationMs: 10,
    pendingCount: 0,
    hardBlockedCount: 0,
    executedThisMonth: 0,
    failedCount: 0,
    overrideCount: 0,
    lastJobRun: null,
    perJobHealth: [],
    staleRunning: { thresholdMinutes: 30, count: 0, sample: [] },
    contentPilotStats: { pending: 0, drafting: 0, publishedThisMonth: 0 },
    adSpendSummary: {
      current: 0,
      previous: 0,
      delta: 0,
      deltaPct: null,
      comparable: false,
      currentPeriod: null,
      previousPeriod: null,
      comparisonLabel: null,
    },
    recsByActionType: [],
    estimatedValueExecuted: null,
    latestInsights: [],
    openOpportunities: { high: 0, medium: 0, low: 0 },
    openMarketInsights: { critical: 0, warning: 0, info: 0 },
    pendingStoreTasks: 0,
    topPendingRecs: [],
    recsPendingOver7Days: 0,
    contentLift: null,
    dbLatencyMs: 1,
    ...overrides,
  };
}

function defaultMocks() {
  mockPrisma.recommendation.groupBy.mockResolvedValue([]);
  mockPrisma.recommendation.count.mockResolvedValue(0);
  mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: null } });
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.groupBy.mockResolvedValue([]);
  mockPrisma.jobRun.findMany.mockResolvedValue([]);
  mockPrisma.jobRun.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.contentProposal.groupBy.mockResolvedValue([]);
  mockPrisma.contentProposal.count.mockResolvedValue(0);
  mockPrisma.contentProposal.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findUnique.mockResolvedValue(null);
  mockPrisma.rawSnapshot.upsert.mockResolvedValue({});
  mockPrisma.opportunity.groupBy.mockResolvedValue([]);
  mockPrisma.marketInsight.groupBy.mockResolvedValue([]);
  mockPrisma.storeTask.count.mockResolvedValue(0);
  mockPrisma.skillInsight.groupBy.mockResolvedValue([]);
  mockPrisma.skillInsight.findMany.mockResolvedValue([]);
  mockPrisma.dailySales.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  defaultMocks();
});

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
      rationale: "Low ROAS",
      estimatedImpact: "Save ₱500/day",
      guardStatus: "clear",
    });
  });

  it("returns recsPendingOver7Days from count", async () => {
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

  it("returns dbLatencyMs as a number", async () => {
    const result = await buildJobsStatusPayload();

    expect(typeof result.dbLatencyMs).toBe("number");
    expect(result.dbLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reads a fresh status snapshot by default", async () => {
    mockPrisma.rawSnapshot.findUnique.mockResolvedValueOnce({
      fetchedAt: new Date(),
      payload: snapshotPayload({ pendingCount: 7 }),
    });

    const result = await getJobsStatusPayload();

    expect(result.pendingCount).toBe(7);
    expect(result.fromSnapshot).toBe(true);
    expect(typeof result.snapshotAgeMs).toBe("number");
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("rebuilds and materializes when the status snapshot is expired", async () => {
    mockPrisma.rawSnapshot.findUnique.mockResolvedValueOnce({
      fetchedAt: new Date(Date.now() - 120_000),
      payload: snapshotPayload({ pendingCount: 7 }),
    });

    const result = await getJobsStatusPayload();

    expect(result.fromSnapshot).toBe(false);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalled();
  });

  it("rebuilds and materializes when the status snapshot payload is invalid", async () => {
    mockPrisma.rawSnapshot.findUnique.mockResolvedValueOnce({
      fetchedAt: new Date(),
      payload: { nope: true },
    });

    const result = await getJobsStatusPayload();

    expect(result.fromSnapshot).toBe(false);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.rawSnapshot.upsert).toHaveBeenCalled();
  });

  it("marks stale running jobs critical and queued jobs info", async () => {
    mockPrisma.jobRun.groupBy
      .mockResolvedValueOnce([
        { jobName: "fetch-ads-data", _max: { startedAt: new Date("2026-06-25T00:00:00.000Z") } },
        { jobName: "run-skills", _max: { startedAt: new Date("2026-06-25T00:05:00.000Z") } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          jobName: "run-skills",
          _count: { _all: 1 },
          _min: { startedAt: new Date("2026-06-25T00:05:00.000Z") },
        },
      ])
      .mockResolvedValueOnce([
        {
          jobName: "fetch-ads-data",
          _count: { _all: 1 },
          _min: { startedAt: new Date("2026-06-25T00:00:00.000Z") },
        },
      ]);
    mockPrisma.jobRun.findMany
      .mockResolvedValueOnce([
        {
          id: "run-1",
          jobName: "fetch-ads-data",
          startedAt: new Date("2026-06-25T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          jobName: "fetch-ads-data",
          status: "running",
          startedAt: new Date("2026-06-25T00:00:00.000Z"),
          errorLog: null,
        },
        {
          jobName: "run-skills",
          status: "queued",
          startedAt: new Date("2026-06-25T00:05:00.000Z"),
          errorLog: null,
        },
      ]);

    const result = await buildJobsStatusPayload();

    expect(result.perJobHealth.find((job) => job.jobName === "fetch-ads-data")).toMatchObject({
      healthStatus: "stale_running",
      severity: "critical",
    });
    expect(result.perJobHealth.find((job) => job.jobName === "run-skills")).toMatchObject({
      healthStatus: "queued",
      severity: "info",
    });
  });

  it("marks never-run jobs separately from failed jobs", async () => {
    mockPrisma.jobRun.groupBy
      .mockResolvedValueOnce([
        { jobName: "fetch-ads-data", _max: { startedAt: new Date("2026-06-25T00:00:00.000Z") } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockPrisma.jobRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          jobName: "fetch-ads-data",
          status: "failed",
          startedAt: new Date("2026-06-25T00:00:00.000Z"),
          errorLog: "Provider failed",
        },
      ]);

    const result = await buildJobsStatusPayload();

    expect(result.perJobHealth.find((job) => job.jobName === "fetch-ads-data")).toMatchObject({
      healthStatus: "failed",
      severity: "critical",
      errorExcerpt: "Provider failed",
    });
    expect(result.perJobHealth.find((job) => job.jobName === "fetch-keyword-research")).toMatchObject({
      healthStatus: "never_run",
      severity: "warning",
    });
  });
});
