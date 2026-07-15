import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  marketInsight: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  shoppingResult: {
    findMany: vi.fn(),
  },
  competitorAd: {
    findMany: vi.fn(),
  },
  keywordResearchResult: {
    findMany: vi.fn(),
  },
  competitor: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  marketKeyword: {
    count: vi.fn(),
  },
  competitorAdCapture: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  jobRun: {
    findFirst: vi.fn(),
  },
}));
const mockAuth = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
  getSessionShop: vi.fn(),
  getSessionUser: vi.fn(),
}));
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  requireAppAuth: mockAuth.requireAppAuth,
  getSessionShop: mockAuth.getSessionShop,
  getSessionUser: mockAuth.getSessionUser,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { GET } from "@/app/api/market-intelligence/route";

describe("market-intelligence GET route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.requireAppAuth.mockResolvedValue(null);
    mockAuth.getSessionShop.mockResolvedValue("agriko.myshopify.com");
    mockAuth.getSessionUser.mockResolvedValue("operator-1");
    mockCheckRateLimit.mockReturnValue(true);
    mockPrisma.marketInsight.findMany.mockResolvedValue([]);
    mockPrisma.marketInsight.count.mockResolvedValue(2);
    mockPrisma.shoppingResult.findMany.mockResolvedValue([]);
    mockPrisma.competitorAd.findMany.mockResolvedValue([]);
    mockPrisma.keywordResearchResult.findMany.mockResolvedValue([]);
    mockPrisma.competitor.count.mockResolvedValue(3);
    mockPrisma.competitor.findMany.mockResolvedValue([]);
    mockPrisma.marketKeyword.count.mockResolvedValue(4);
    mockPrisma.competitorAdCapture.count.mockResolvedValue(5);
    mockPrisma.competitorAdCapture.findMany.mockResolvedValue([]);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-1",
      jobName: "fetch-market-intel",
      startedAt: new Date("2026-06-25T00:00:00.000Z"),
      completedAt: new Date("2026-06-25T00:00:05.000Z"),
      status: "success",
    });
  });

  it("does not reuse an in-flight ordinary read for an explicit refresh", async () => {
    let resolveInsights!: (value: []) => void;
    const initialInsights = new Promise<[]>((resolve) => { resolveInsights = resolve; });
    mockPrisma.marketInsight.findMany
      .mockImplementationOnce(() => initialInsights)
      .mockResolvedValue([]);

    const ordinary = GET(new Request("http://test.local/api/market-intelligence"));
    await vi.waitFor(() => expect(mockPrisma.marketInsight.findMany).toHaveBeenCalledTimes(1));
    const refresh = GET(new Request("http://test.local/api/market-intelligence?refresh=1"));

    const refreshStarted = vi.waitFor(() => expect(mockPrisma.marketInsight.findMany).toHaveBeenCalledTimes(2));
    try {
      await refreshStarted;
    } finally {
      resolveInsights([]);
      await Promise.all([ordinary, refresh]);
    }
  });

  it("computes openInsights using a full count, not the capped insights list", async () => {
    const openRows = Array.from({ length: 60 }, (_, i) => ({
      id: `insight-${i}`,
      createdAt: new Date(`2026-06-25T00:${String(i).padStart(2, "0")}:00.000Z`),
      type: "ads",
      severity: "medium",
      title: `title-${i}`,
      summary: `summary-${i}`,
      status: i % 2 === 0 ? "open" : "closed",
      competitor: { name: `competitor-${i % 3}` },
      keyword: { keyword: `keyword-${i % 4}` },
      ad: { adCopy: "copy", headline: "head", description: "desc", pageName: "page" },
    }));

    mockPrisma.marketInsight.findMany.mockResolvedValue(openRows);
    mockPrisma.marketInsight.count.mockResolvedValue(120);

    const res = await GET(new Request("http://test.local/api/market-intelligence?refresh=1"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.stats.openInsights).toBe(120);
    expect(mockPrisma.marketInsight.count).toHaveBeenCalledWith({
      where: { status: "open" },
    });
    // The route must now use a dedicated count query instead of relying on the
    // capped, first-60 insight list.
    expect(mockPrisma.marketInsight.findMany).toHaveBeenCalledTimes(1);
  });

  it("requests only the newest row for each displayed keyword", async () => {
    await GET(new Request("http://test.local/api/market-intelligence?refresh=1"));

    expect(mockPrisma.keywordResearchResult.findMany).toHaveBeenCalledWith(expect.objectContaining({
      distinct: ["keyword"],
      orderBy: { capturedAt: "desc" },
    }));
  });

  it("paginates the insight feed instead of silently hiding the backlog", async () => {
    mockPrisma.marketInsight.count.mockResolvedValue(120);

    const res = await GET(new Request("http://test.local/api/market-intelligence?refresh=1&insightsPage=2"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.marketInsight.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 60,
      take: 60,
    }));
    expect(payload.insightsPageInfo).toEqual({ page: 2, pageSize: 60, total: 120, hasMore: false });
  });

  it("rejects forced refreshes before starting database aggregation when rate limited", async () => {
    mockCheckRateLimit.mockReturnValueOnce(false);

    const res = await GET(new Request("http://test.local/api/market-intelligence?refresh=1"));

    expect(res.status).toBe(429);
    expect(mockPrisma.marketInsight.findMany).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).toHaveBeenCalledWith("market-intelligence-refresh:agriko.myshopify.com", 10, 60_000);
  });

  it("deduplicates concurrent forced refreshes", async () => {
    let resolveInsights: ((value: []) => void) | undefined;
    mockPrisma.marketInsight.findMany.mockImplementationOnce(
      () => new Promise<[]>((resolve) => { resolveInsights = resolve; }),
    );

    const first = GET(new Request("http://test.local/api/market-intelligence?refresh=1"));
    const second = GET(new Request("http://test.local/api/market-intelligence?refresh=1"));

    await vi.waitFor(() => expect(mockPrisma.marketInsight.findMany).toHaveBeenCalledTimes(1));
    resolveInsights?.([]);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

});
