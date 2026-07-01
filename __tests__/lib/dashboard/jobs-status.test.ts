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
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { buildJobsStatusPayload } = await import("@/lib/dashboard/jobs-status");

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.recommendation.groupBy.mockResolvedValue([
    { status: "pending", _count: { _all: 3 } },
    { status: "executed", _count: { _all: 10 } },
  ]);
  mockPrisma.recommendation.count.mockResolvedValue(1);
  mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: 4500 } });
  mockPrisma.jobRun.findFirst.mockResolvedValue(null);
  mockPrisma.jobRun.groupBy.mockResolvedValue([]);
  mockPrisma.jobRun.findMany.mockResolvedValue([]);
  mockPrisma.jobRun.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.contentProposal.groupBy.mockResolvedValue([
    { status: "pending", _count: { _all: 2 } },
  ]);
  mockPrisma.contentProposal.count.mockResolvedValue(5);
  mockPrisma.rawSnapshot.findMany.mockResolvedValue([]);
  mockPrisma.rawSnapshot.findUnique.mockResolvedValue(null);
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.contentProposal.findMany.mockResolvedValue([]);
  mockPrisma.opportunity.groupBy.mockResolvedValue([]);
  mockPrisma.marketInsight.groupBy.mockResolvedValue([]);
  mockPrisma.storeTask.count.mockResolvedValue(0);
  mockPrisma.skillInsight.groupBy.mockResolvedValue([]);
  mockPrisma.skillInsight.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
});

describe("buildJobsStatusPayload – new fields", () => {
  it("returns contentPilotStats with pending and publishedThisMonth counts", async () => {
    mockPrisma.contentProposal.groupBy.mockResolvedValue([
      { status: "pending", _count: { _all: 4 } },
      { status: "approved", _count: { _all: 1 } },
    ]);
    mockPrisma.contentProposal.count.mockResolvedValue(3);

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
        dateRangeStart: new Date("2026-06-18T00:00:00.000Z"),
        dateRangeEnd: new Date("2026-06-25T00:00:00.000Z"),
      },
      {
        payload: {
          insights: [
            { spend: "80.00", clicks: 40, impressions: 900, actions: [], action_values: [] },
          ],
        },
        dateRangeStart: new Date("2026-06-11T00:00:00.000Z"),
        dateRangeEnd: new Date("2026-06-18T00:00:00.000Z"),
      },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.adSpendSummary.current).toBeCloseTo(150);
    expect(result.adSpendSummary.previous).toBeCloseTo(80);
    expect(result.adSpendSummary.delta).toBeCloseTo(70);
    expect(result.adSpendSummary.deltaPct).toBeCloseTo(87.5);
    expect(result.adSpendSummary.comparable).toBe(true);
    expect(result.adSpendSummary.currentPeriod?.label).toBe("2026-06-18 to 2026-06-25");
    expect(result.adSpendSummary.previousPeriod?.label).toBe("2026-06-11 to 2026-06-18");
  });

  it("returns adSpendSummary with null deltaPct when no prior snapshot", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([
      {
        payload: {
          insights: [
            { spend: "200.00", clicks: 100, impressions: 2000, actions: [], action_values: [] },
          ],
        },
        dateRangeStart: new Date("2026-06-18T00:00:00.000Z"),
        dateRangeEnd: new Date("2026-06-25T00:00:00.000Z"),
      },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.adSpendSummary.current).toBeCloseTo(200);
    expect(result.adSpendSummary.previous).toBe(0);
    expect(result.adSpendSummary.delta).toBe(0);
    expect(result.adSpendSummary.deltaPct).toBeNull();
    expect(result.adSpendSummary.comparable).toBe(false);
    expect(result.adSpendSummary.previousPeriod).toBeNull();
  });

  it("hides ad spend delta when the previous Meta snapshot has a different period length", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([
      {
        payload: {
          insights: [{ spend: "200.00", clicks: 100, impressions: 2000, actions: [], action_values: [] }],
        },
        dateRangeStart: new Date("2026-06-18T00:00:00.000Z"),
        dateRangeEnd: new Date("2026-06-25T00:00:00.000Z"),
      },
      {
        payload: {
          insights: [{ spend: "80.00", clicks: 40, impressions: 900, actions: [], action_values: [] }],
        },
        dateRangeStart: new Date("2026-06-01T00:00:00.000Z"),
        dateRangeEnd: new Date("2026-06-25T00:00:00.000Z"),
      },
    ]);

    const result = await buildJobsStatusPayload();

    expect(result.adSpendSummary.current).toBeCloseTo(200);
    expect(result.adSpendSummary.previous).toBe(0);
    expect(result.adSpendSummary.delta).toBe(0);
    expect(result.adSpendSummary.deltaPct).toBeNull();
    expect(result.adSpendSummary.comparable).toBe(false);
    expect(result.adSpendSummary.comparisonLabel).toBeNull();
  });

  it("returns adSpendSummary zeroes when no Meta snapshots exist", async () => {
    mockPrisma.rawSnapshot.findMany.mockResolvedValue([]);

    const result = await buildJobsStatusPayload();

    expect(result.adSpendSummary.current).toBe(0);
    expect(result.adSpendSummary.previous).toBe(0);
    expect(result.adSpendSummary.delta).toBe(0);
    expect(result.adSpendSummary.deltaPct).toBeNull();
  });

  it("returns recsByActionType for executed recs this month", async () => {
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

  it("returns estimatedValueExecuted as null when no values set", async () => {
    mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: null } });

    const result = await buildJobsStatusPayload();

    expect(result.estimatedValueExecuted).toBeNull();
  });

  it("returns estimatedValueExecuted sum when values exist", async () => {
    mockPrisma.recommendation.aggregate.mockResolvedValue({ _sum: { estimatedValuePhp: 4500 } });

    const result = await buildJobsStatusPayload();

    expect(result.estimatedValueExecuted).toBe(4500);
  });

  it("selects the latest skill insight per type without Prisma distinct ordering", async () => {
    const latestFatigueAt = new Date("2026-06-25T12:00:00.000Z");
    const latestSearchAt = new Date("2026-06-24T12:00:00.000Z");
    mockPrisma.skillInsight.groupBy.mockResolvedValue([
      { insightType: "fatigue-report", _max: { createdAt: latestFatigueAt } },
      { insightType: "search-term-opportunities", _max: { createdAt: latestSearchAt } },
    ]);
    mockPrisma.skillInsight.findMany.mockResolvedValue([
      {
        id: "insight-2",
        insightType: "fatigue-report",
        skillId: "skill-new",
        createdAt: latestFatigueAt,
        items: [{ title: "new" }],
      },
      {
        id: "insight-3",
        insightType: "search-term-opportunities",
        skillId: "skill-search",
        createdAt: latestSearchAt,
        items: [],
      },
    ]);

    const result = await buildJobsStatusPayload();

    expect(mockPrisma.skillInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { insightType: "fatigue-report", createdAt: latestFatigueAt },
            { insightType: "search-term-opportunities", createdAt: latestSearchAt },
          ],
        },
      }),
    );
    expect(result.latestInsights).toEqual([
      {
        insightType: "fatigue-report",
        skillId: "skill-new",
        createdAt: latestFatigueAt.toISOString(),
        items: [{ title: "new" }],
      },
      {
        insightType: "search-term-opportunities",
        skillId: "skill-search",
        createdAt: latestSearchAt.toISOString(),
        items: [],
      },
    ]);
  });
});
