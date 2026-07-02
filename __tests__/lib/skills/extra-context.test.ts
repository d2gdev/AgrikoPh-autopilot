import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    rawSnapshot: { findFirst: vi.fn() },
    competitorAd: { findMany: vi.fn() },
    competitorAdCapture: { findMany: vi.fn() },
    shoppingPriceHistory: { findMany: vi.fn() },
    marketInsight: { findMany: vi.fn() },
    keywordResearchResult: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { buildExtraContext } from "@/lib/skills/extra-context";

const mockPrisma = prisma as unknown as {
  rawSnapshot: { findFirst: ReturnType<typeof vi.fn> };
  competitorAd: { findMany: ReturnType<typeof vi.fn> };
  competitorAdCapture: { findMany: ReturnType<typeof vi.fn> };
  shoppingPriceHistory: { findMany: ReturnType<typeof vi.fn> };
  marketInsight: { findMany: ReturnType<typeof vi.fn> };
  keywordResearchResult: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.rawSnapshot.findFirst.mockResolvedValue(null);
  mockPrisma.competitorAd.findMany.mockResolvedValue([]);
  mockPrisma.competitorAdCapture.findMany.mockResolvedValue([]);
  mockPrisma.shoppingPriceHistory.findMany.mockResolvedValue([]);
  mockPrisma.marketInsight.findMany.mockResolvedValue([]);
  mockPrisma.keywordResearchResult.findMany.mockResolvedValue([]);
});

describe("buildExtraContext", () => {
  it("returns an empty object for an empty sources array", async () => {
    const result = await buildExtraContext([]);
    expect(result).toEqual({});
  });

  it("ignores unknown source names", async () => {
    const result = await buildExtraContext(["not_a_real_source"]);
    expect(result).toEqual({});
  });

  describe("gsc", () => {
    it("loads the latest gsc snapshot, sorted by clicks, capped at 100", async () => {
      const queries = Array.from({ length: 150 }, (_, i) => ({
        query: `q${i}`,
        clicks: i,
        impressions: i * 10,
        ctr: "1%",
        position: "5",
      }));
      mockPrisma.rawSnapshot.findFirst.mockResolvedValueOnce({
        id: "snap-1",
        dateRangeStart: new Date("2026-06-01"),
        dateRangeEnd: new Date("2026-06-30"),
        payload: { topQueries: queries },
      });

      const result = await buildExtraContext(["gsc"]);
      const gsc = result.gsc as { topQueries: Array<{ query: string; clicks: number }> };

      expect(gsc.topQueries).toHaveLength(100);
      expect(gsc.topQueries[0]!.clicks).toBe(149); // sorted desc by clicks
      expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { source: "gsc" } })
      );
    });

    it("falls back to gsc_query_page when gsc snapshot is absent", async () => {
      mockPrisma.rawSnapshot.findFirst
        .mockResolvedValueOnce(null) // gsc
        .mockResolvedValueOnce({
          id: "snap-2",
          dateRangeStart: new Date(),
          dateRangeEnd: new Date(),
          // Real gsc_query_page payload shape is { pairs, fetchedAt } — see lib/connectors/gsc.ts fetchGscQueryPageData
          payload: {
            pairs: [
              { query: "a", page: "/p1", clicks: 1, impressions: 10, position: "3.0" },
              { query: "b", page: "/p2", clicks: 5, impressions: 20, position: "1.2" },
            ],
            fetchedAt: "2026-07-01T00:00:00.000Z",
          },
        });

      const result = await buildExtraContext(["gsc"]);
      expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { source: "gsc_query_page" } })
      );
      const gsc = result.gsc as { topQueries: Array<{ query: string; clicks: number; impressions: number; position: string }> };
      expect(gsc.topQueries).toHaveLength(2);
      // mapped into the same shape as the primary path, sorted by clicks desc
      expect(gsc.topQueries[0]).toEqual({ query: "b", clicks: 5, impressions: 20, position: "1.2" });
      expect(gsc.topQueries[1]).toEqual({ query: "a", clicks: 1, impressions: 10, position: "3.0" });
    });

    it("falls back to dataforseo_ranked when neither gsc nor gsc_query_page exist", async () => {
      mockPrisma.rawSnapshot.findFirst
        .mockResolvedValueOnce(null) // gsc
        .mockResolvedValueOnce(null) // gsc_query_page
        .mockResolvedValueOnce({
          id: "snap-3",
          dateRangeStart: new Date("2026-07-01"),
          dateRangeEnd: new Date("2026-07-01"),
          payload: {
            domain: "agrikoph.com",
            topQueries: [
              { keyword: "turmeric powder", position: 4, searchVolume: 1200, cpc: 0.45, url: "https://agrikoph.com/turmeric" },
              { keyword: "moringa tea", position: 2, searchVolume: 3000, cpc: 0.3, url: "https://agrikoph.com/moringa" },
            ],
          },
        });

      const result = await buildExtraContext(["gsc"]);

      expect(mockPrisma.rawSnapshot.findFirst).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ where: { source: "dataforseo_ranked" } })
      );
      const gsc = result.gsc as {
        source: string;
        topQueries: Array<{ query: string; position: number; searchVolume: number }>;
      };
      expect(gsc.source).toBe("dataforseo");
      // sorted by searchVolume desc; no clicks/impressions fields faked in.
      expect(gsc.topQueries[0]).toEqual({ query: "moringa tea", position: 2, searchVolume: 3000 });
      expect(gsc.topQueries[1]).toEqual({ query: "turmeric powder", position: 4, searchVolume: 1200 });
      expect((gsc.topQueries[0] as Record<string, unknown>).clicks).toBeUndefined();
    });

    it("returns null when no gsc, gsc_query_page, or dataforseo_ranked snapshot exists", async () => {
      const result = await buildExtraContext(["gsc"]);
      expect(result.gsc).toBeNull();
    });
  });

  describe("ga4", () => {
    it("loads the latest ga4 snapshot, sorted by sessions, capped at 50", async () => {
      const pages = Array.from({ length: 60 }, (_, i) => ({
        page: `/p${i}`,
        sessions: i,
        bounceRate: "40%",
        conversionRate: "2%",
      }));
      mockPrisma.rawSnapshot.findFirst.mockResolvedValueOnce({
        id: "snap-1",
        dateRangeStart: new Date(),
        dateRangeEnd: new Date(),
        payload: { topPages: pages },
      });

      const result = await buildExtraContext(["ga4"]);
      const ga4 = result.ga4 as { topLandingPages: Array<{ page: string; sessions: number }> };

      expect(ga4.topLandingPages).toHaveLength(50);
      expect(ga4.topLandingPages[0]!.sessions).toBe(59);
    });

    it("returns null when no ga4 snapshot exists", async () => {
      const result = await buildExtraContext(["ga4"]);
      expect(result.ga4).toBeNull();
    });
  });

  describe("market_intel", () => {
    it("returns compact competitor ads, price changes, and open insights", async () => {
      mockPrisma.competitorAd.findMany.mockResolvedValueOnce([
        {
          competitor: { name: "Acme" },
          headline: "Buy now",
          adCopy: "x".repeat(300),
          cta: "Shop Now",
          startDate: new Date("2026-06-01"),
          activeStatus: "ACTIVE",
        },
      ]);
      mockPrisma.shoppingPriceHistory.findMany.mockResolvedValueOnce([
        { productKey: "sku-1", title: "Moringa", store: "Acme", price: 100, previousPrice: 120, priceDelta: -20, priceDeltaPct: -16.7, capturedAt: new Date() },
      ]);
      mockPrisma.marketInsight.findMany.mockResolvedValueOnce([
        { type: "price_drop", severity: "warning", title: "Competitor cut price", summary: "Acme dropped price 17%" },
      ]);

      mockPrisma.competitorAdCapture.findMany.mockResolvedValueOnce([
        {
          adArchiveId: "arch-1",
          competitorId: "comp-1",
          competitor: { name: "Acme" },
          headline: "Buy now",
          headlineEn: null,
          adCopy: "great deal",
          adCopyEn: null,
          activeStatus: "ACTIVE",
          capturedAt: new Date("2026-06-01"),
        },
        {
          adArchiveId: "arch-1",
          competitorId: "comp-1",
          competitor: { name: "Acme" },
          headline: "Buy now",
          headlineEn: null,
          adCopy: "great deal",
          adCopyEn: null,
          activeStatus: "ACTIVE",
          capturedAt: new Date("2026-06-10"),
        },
      ]);

      const result = await buildExtraContext(["market_intel"]);
      const mi = result.market_intel as {
        competitorAds: Array<{ competitor: string; adCopy: string }>;
        priceChanges: unknown[];
        marketInsights: unknown[];
        longRunningAds: Array<{ competitor: string; headline: string; daysActive: number; stillActive: boolean }>;
      };

      expect(mi.competitorAds).toHaveLength(1);
      expect(mi.competitorAds[0]!.competitor).toBe("Acme");
      expect(mi.competitorAds[0]!.adCopy.length).toBe(200); // truncated to 200 chars
      expect(mi.priceChanges).toHaveLength(1);
      expect(mi.marketInsights).toHaveLength(1);
      expect(mi.longRunningAds).toHaveLength(1);
      expect(mi.longRunningAds[0]).toEqual({ competitor: "Acme", headline: "Buy now", daysActive: 9, stillActive: true });

      expect(mockPrisma.competitorAd.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ activeStatus: "ACTIVE" }), take: 30 })
      );
      expect(mockPrisma.marketInsight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "open" }, take: 10 })
      );
    });

    it("returns empty arrays when no market intel data exists", async () => {
      const result = await buildExtraContext(["market_intel"]);
      expect(result.market_intel).toEqual({
        competitorAds: [],
        priceChanges: [],
        marketInsights: [],
        longRunningAds: [],
      });
    });
  });

  describe("keyword_research", () => {
    it("returns up to 50 keyword research rows", async () => {
      mockPrisma.keywordResearchResult.findMany.mockResolvedValueOnce([
        {
          keyword: "moringa tea",
          avgMonthlySearches: 1000,
          competition: "MEDIUM",
          lowTopOfPageBidMicros: BigInt(500000),
          highTopOfPageBidMicros: BigInt(1500000),
        },
      ]);

      const result = await buildExtraContext(["keyword_research"]);
      const rows = result.keyword_research as Array<{ keyword: string; lowTopOfPageBidMicros: string | null }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.keyword).toBe("moringa tea");
      expect(rows[0]!.lowTopOfPageBidMicros).toBe("500000"); // BigInt serialized to string
      expect(mockPrisma.keywordResearchResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });

    it("returns an empty array when no keyword research rows exist", async () => {
      const result = await buildExtraContext(["keyword_research"]);
      expect(result.keyword_research).toEqual([]);
    });
  });

  it("builds multiple sources concurrently and namespaces by source key", async () => {
    const result = await buildExtraContext(["gsc", "market_intel"]);
    expect(Object.keys(result).sort()).toEqual(["gsc", "market_intel"]);
  });

  it("resolves to null for a source rather than throwing when the query fails", async () => {
    mockPrisma.rawSnapshot.findFirst.mockRejectedValueOnce(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await buildExtraContext(["gsc"]);
    expect(result.gsc).toBeNull();

    warnSpy.mockRestore();
  });
});
