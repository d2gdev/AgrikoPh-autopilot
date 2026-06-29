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
  },
  marketKeyword: {
    count: vi.fn(),
  },
  competitorAdCapture: {
    count: vi.fn(),
  },
  jobRun: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAppAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { GET } from "@/app/api/market-intelligence/route";

describe("market-intelligence GET route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.marketInsight.findMany.mockResolvedValue([]);
    mockPrisma.marketInsight.count.mockResolvedValue(2);
    mockPrisma.shoppingResult.findMany.mockResolvedValue([]);
    mockPrisma.competitorAd.findMany.mockResolvedValue([]);
    mockPrisma.keywordResearchResult.findMany.mockResolvedValue([]);
    mockPrisma.competitor.count.mockResolvedValue(3);
    mockPrisma.marketKeyword.count.mockResolvedValue(4);
    mockPrisma.competitorAdCapture.count.mockResolvedValue(5);
    mockPrisma.jobRun.findFirst.mockResolvedValue({
      id: "run-1",
      jobName: "fetch-market-intel",
      startedAt: new Date("2026-06-25T00:00:00.000Z"),
      completedAt: new Date("2026-06-25T00:00:05.000Z"),
      status: "success",
    });
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
});
