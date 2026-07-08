import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  rawSnapshot: {
    findFirst: vi.fn(),
  },
  keywordResearchResult: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  marketInsight: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  articleSnapshot: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
}));

const mockJobs = vi.hoisted(() => ({
  fetchSeoDataHandler: vi.fn(),
  fetchKeywordResearchHandler: vi.fn(),
  fetchBlogContentHandler: vi.fn(),
  fetchMarketIntelHandler: vi.fn(),
  fetchOrdersHandler: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/jobs/fetch-seo-data", () => ({ fetchSeoDataHandler: mockJobs.fetchSeoDataHandler }));
vi.mock("@/jobs/fetch-keyword-research", () => ({ fetchKeywordResearchHandler: mockJobs.fetchKeywordResearchHandler }));
vi.mock("@/jobs/fetch-blog-content", () => ({ fetchBlogContentHandler: mockJobs.fetchBlogContentHandler }));
vi.mock("@/jobs/fetch-market-intel", () => ({ fetchMarketIntelHandler: mockJobs.fetchMarketIntelHandler }));
vi.mock("@/jobs/fetch-orders", () => ({ fetchOrdersHandler: mockJobs.fetchOrdersHandler }));

import {
  checkSourceStatus,
  refreshSourcesOnce,
  selectBaseSnapshotForSource,
} from "@/lib/skills/source-registry";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);
  mockPrisma.keywordResearchResult.findFirst.mockResolvedValue(null);
  mockPrisma.keywordResearchResult.count.mockResolvedValue(0);
  mockPrisma.marketInsight.findFirst.mockResolvedValue(null);
  mockPrisma.marketInsight.count.mockResolvedValue(0);
  mockPrisma.articleSnapshot.findFirst.mockResolvedValue(null);
  mockPrisma.articleSnapshot.count.mockResolvedValue(0);

  mockJobs.fetchSeoDataHandler.mockResolvedValue({ status: "success", errors: [] });
  mockJobs.fetchKeywordResearchHandler.mockResolvedValue({ status: "success", errors: [] });
  mockJobs.fetchBlogContentHandler.mockResolvedValue({ status: "success", errors: [] });
  mockJobs.fetchMarketIntelHandler.mockResolvedValue({ status: "success", errors: [] });
  mockJobs.fetchOrdersHandler.mockResolvedValue({ status: "success", errors: [] });
});

describe("checkSourceStatus", () => {
  it("returns fresh for a recent gsc snapshot", async () => {
    mockPrisma.rawSnapshot.findFirst.mockResolvedValue({
      id: "snap-gsc",
      source: "gsc",
      fetchedAt: new Date("2026-07-09T01:00:00Z"),
      payload: { topQueries: [{ query: "organic rice" }] },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T02:00:00Z"));

    await expect(checkSourceStatus("gsc", 72)).resolves.toMatchObject({
      source: "gsc",
      state: "fresh",
      evidenceId: "snap-gsc",
      rowCount: 1,
    });
  });

  it("returns missing for keyword_research when no rows exist", async () => {
    mockPrisma.keywordResearchResult.findFirst.mockResolvedValue(null);
    mockPrisma.keywordResearchResult.count.mockResolvedValue(0);

    await expect(checkSourceStatus("keyword_research", 168)).resolves.toMatchObject({
      source: "keyword_research",
      state: "missing",
      latestAt: null,
      rowCount: 0,
    });
  });

  it("uses open market insights as evidence for market_intel", async () => {
    mockPrisma.marketInsight.findFirst.mockResolvedValue({
      id: "insight-1",
      createdAt: new Date("2026-07-09T01:00:00Z"),
    });
    mockPrisma.marketInsight.count.mockResolvedValue(4);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T02:00:00Z"));

    await expect(checkSourceStatus("market_intel", 72)).resolves.toMatchObject({
      source: "market_intel",
      state: "fresh",
      evidenceId: "insight-1",
      rowCount: 4,
    });
  });

  it("uses article snapshots as evidence for blog", async () => {
    mockPrisma.articleSnapshot.findFirst.mockResolvedValue({
      id: "article-snap-1",
      capturedAt: new Date("2026-07-09T01:00:00Z"),
    });
    mockPrisma.articleSnapshot.count.mockResolvedValue(12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T02:00:00Z"));

    await expect(checkSourceStatus("blog", 72)).resolves.toMatchObject({
      source: "blog",
      state: "fresh",
      evidenceId: "article-snap-1",
      rowCount: 12,
    });
  });
});

describe("selectBaseSnapshotForSource", () => {
  it("chooses the freshest non-Meta market evidence snapshot for market_intel", async () => {
    mockPrisma.rawSnapshot.findFirst.mockImplementation(async (args: { where?: { source?: string } }) => {
      switch (args.where?.source) {
        case "dataforseo_ranked":
          return {
            id: "ranked-1",
            source: "dataforseo_ranked",
            fetchedAt: new Date("2026-07-09T00:30:00Z"),
            payload: { topQueries: [] },
          };
        case "dataforseo_keyword_gap":
          return {
            id: "gap-1",
            source: "dataforseo_keyword_gap",
            fetchedAt: new Date("2026-07-09T01:30:00Z"),
            payload: { intersections: [] },
          };
        case "shopify_catalog":
          return {
            id: "catalog-1",
            source: "shopify_catalog",
            fetchedAt: new Date("2026-07-09T01:00:00Z"),
            payload: [{ handle: "organic-rice" }],
          };
        default:
          return null;
      }
    });

    await expect(selectBaseSnapshotForSource("market_intel")).resolves.toMatchObject({
      id: "gap-1",
      source: "dataforseo_keyword_gap",
    });
  });
});

describe("refreshSourcesOnce", () => {
  it("refreshes each requested source once", async () => {
    mockJobs.fetchSeoDataHandler.mockResolvedValue({ status: "success", errors: [] });
    mockJobs.fetchKeywordResearchHandler.mockResolvedValue({ status: "partial", errors: ["low seed count"] });

    const result = await refreshSourcesOnce(["gsc", "ga4", "keyword_research", "gsc"]);

    expect(mockJobs.fetchSeoDataHandler).toHaveBeenCalledTimes(1);
    expect(mockJobs.fetchKeywordResearchHandler).toHaveBeenCalledTimes(1);
    expect(result.gsc).toMatchObject({ attempted: true, status: "success" });
    expect(result.ga4).toMatchObject({ attempted: true, status: "success" });
    expect(result.keyword_research).toMatchObject({ attempted: true, status: "partial" });
  });

  it("shares one market intel refresh across market-backed sources", async () => {
    const result = await refreshSourcesOnce(["market_intel", "dataforseo_ranked", "shopify_catalog"]);

    expect(mockJobs.fetchMarketIntelHandler).toHaveBeenCalledTimes(1);
    expect(mockJobs.fetchMarketIntelHandler).toHaveBeenCalledWith({ profile: "smoke" });
    expect(result.market_intel).toMatchObject({ attempted: true, status: "success" });
    expect(result.dataforseo_ranked).toMatchObject({ attempted: true, status: "success" });
    expect(result.shopify_catalog).toMatchObject({ attempted: true, status: "success" });
  });
});
