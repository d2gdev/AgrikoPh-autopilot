import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    marketKeyword: {
      findMany: vi.fn(),
    },
    shoppingResult: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    shoppingPriceHistory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    marketInsight: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    competitor: {
      findMany: vi.fn(),
    },
    competitorSocialPage: {
      findMany: vi.fn(),
    },
    rawSnapshot: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/connectors/meta-ad-library", () => ({}));
vi.mock("@/lib/connectors/apify-meta-ads", () => ({
  isApifyMetaEnabled: vi.fn().mockResolvedValue(false),
  fetchApifyMetaAdsByPages: vi.fn(),
}));
vi.mock("@/lib/connectors/dataforseo-shopping", () => ({
  fetchShoppingProducts: vi.fn(),
}));
vi.mock("@/lib/connectors/dataforseo-labs", () => ({
  fetchRankedKeywords: vi.fn(),
  fetchDomainIntersection: vi.fn(),
  resolveLabsLimit: vi.fn().mockReturnValue(20),
}));
vi.mock("@/lib/connectors/serper-shopping", () => ({
  fetchSerperShoppingProducts: vi.fn(),
}));
vi.mock("@/lib/market-intel/translate-captures", () => ({
  fillCaptureTranslations: vi.fn(),
}));
vi.mock("@/lib/market-intel/classify-angles", () => ({
  fillCreativeAngles: vi.fn(),
}));
vi.mock("@/lib/market-intel/ad-captures", () => ({
  recordCompetitorAdCapture: vi.fn(),
}));
vi.mock("@/lib/market-intel/spam-filter", () => ({
  isSpamStoryAd: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/market-intel/profiles", () => ({
  resolveRunLimits: vi.fn(),
}));
vi.mock("@/lib/shopify-admin", () => ({
  fetchCatalogProducts: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { resolveRunLimits } from "@/lib/market-intel/profiles";
import { fetchSerperShoppingProducts } from "@/lib/connectors/serper-shopping";
import { fetchCatalogProducts } from "@/lib/shopify-admin";
import { fetchRankedKeywords, fetchDomainIntersection } from "@/lib/connectors/dataforseo-labs";
import { fetchMarketIntelHandler } from "@/jobs/fetch-market-intel";

const mockJobRun = prisma.jobRun as unknown as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
};
const mockMarketKeyword = prisma.marketKeyword as unknown as { findMany: ReturnType<typeof vi.fn> };
const mockShoppingResult = prisma.shoppingResult as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};
const mockPriceHistory = prisma.shoppingPriceHistory as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
};
const mockMarketInsight = prisma.marketInsight as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};
const mockCompetitor = prisma.competitor as unknown as { findMany: ReturnType<typeof vi.fn> };
const mockSocialPage = prisma.competitorSocialPage as unknown as { findMany: ReturnType<typeof vi.fn> };
const mockRawSnapshot = prisma.rawSnapshot as unknown as { upsert: ReturnType<typeof vi.fn> };

const mockResolveRunLimits = resolveRunLimits as unknown as ReturnType<typeof vi.fn>;
const mockFetchSerper = fetchSerperShoppingProducts as unknown as ReturnType<typeof vi.fn>;
const mockFetchCatalog = fetchCatalogProducts as unknown as ReturnType<typeof vi.fn>;
const mockFetchRankedKeywords = fetchRankedKeywords as unknown as ReturnType<typeof vi.fn>;
const mockFetchDomainIntersection = fetchDomainIntersection as unknown as ReturnType<typeof vi.fn>;

function competitorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "comp-1",
    name: "Rival Co",
    domain: "https://www.rival.example/",
    active: true,
    ...overrides,
  };
}

function gapItem(overrides: Record<string, unknown> = {}) {
  return {
    keyword: "turmeric capsules",
    competitorPosition: 5,
    ourPosition: null,
    searchVolume: 500,
    cpc: 0.8,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockResolveRunLimits.mockReturnValue({
    keywordLimit: 0,
    shoppingResultLimit: 5,
    competitorPageLimit: 0,
    adLimitPerPage: 0,
    longRunningAdDays: 30,
    sources: ["shopping"],
  });

  mockJobRun.create.mockResolvedValue({ id: "run-1" });
  mockJobRun.update.mockResolvedValue({});
  mockJobRun.findUnique.mockResolvedValue({ id: "run-1", jobName: "fetch-market-intel" });

  mockMarketKeyword.findMany.mockResolvedValue([]);
  mockFetchSerper.mockResolvedValue({ disabled: false, products: [] });
  mockShoppingResult.findUnique.mockResolvedValue(null);
  mockShoppingResult.upsert.mockResolvedValue({});
  mockShoppingResult.findFirst.mockResolvedValue({ id: "recent" });
  mockShoppingResult.findMany.mockResolvedValue([]);
  mockPriceHistory.findUnique.mockResolvedValue(null);
  mockPriceHistory.upsert.mockResolvedValue({});
  mockPriceHistory.findFirst.mockResolvedValue(null);
  mockMarketInsight.findUnique.mockResolvedValue(null);
  mockMarketInsight.upsert.mockResolvedValue({});
  mockMarketInsight.findFirst.mockResolvedValue(null);
  mockMarketInsight.create.mockResolvedValue({});
  mockSocialPage.findMany.mockResolvedValue([]);
  mockRawSnapshot.upsert.mockResolvedValue({});
  mockFetchCatalog.mockResolvedValue([]);
  mockCompetitor.findMany.mockResolvedValue([]);

  mockFetchRankedKeywords.mockResolvedValue({ items: [] });
  mockFetchDomainIntersection.mockResolvedValue({ items: [] });

  delete process.env.DATAFORSEO_LABS_ENABLED;
  delete process.env.MARKET_INTEL_OWN_DOMAIN;
});

describe("DataForSEO Labs step — disabled by default", () => {
  it("skips entirely when DATAFORSEO_LABS_ENABLED is unset — no fetch, no snapshot", async () => {
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchRankedKeywords).not.toHaveBeenCalled();
    expect(mockFetchDomainIntersection).not.toHaveBeenCalled();
    expect(mockCompetitor.findMany).not.toHaveBeenCalled();
    expect(mockRawSnapshot.upsert.mock.calls.some((c) => String(c[0].create.source).startsWith("dataforseo"))).toBe(false);
  });

  it("skips entirely when DATAFORSEO_LABS_ENABLED=false", async () => {
    process.env.DATAFORSEO_LABS_ENABLED = "false";
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchRankedKeywords).not.toHaveBeenCalled();
    expect(mockRawSnapshot.upsert.mock.calls.some((c) => String(c[0].create.source).startsWith("dataforseo"))).toBe(false);
  });
});

describe("DataForSEO Labs step — enabled", () => {
  beforeEach(() => {
    process.env.DATAFORSEO_LABS_ENABLED = "true";
  });

  it("fetches ranked keywords for MARKET_INTEL_OWN_DOMAIN (default agrikoph.com) and writes a dataforseo_ranked RawSnapshot", async () => {
    mockFetchRankedKeywords.mockResolvedValue({
      items: [{ keyword: "turmeric powder", position: 3, searchVolume: 1000, cpc: 0.5, url: null }],
    });

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchRankedKeywords).toHaveBeenCalledWith("agrikoph.com", 20);
    const rankedCall = mockRawSnapshot.upsert.mock.calls.find(
      (c) => c[0].create.source === "dataforseo_ranked"
    );
    expect(rankedCall).toBeDefined();
    expect(rankedCall![0].create.dateRangeStart).toEqual(rankedCall![0].create.dateRangeEnd);
    expect(rankedCall![0].create.payload.topQueries).toHaveLength(1);
  });

  it("honors a custom MARKET_INTEL_OWN_DOMAIN", async () => {
    process.env.MARKET_INTEL_OWN_DOMAIN = "https://www.custom-domain.ph/";
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchRankedKeywords).toHaveBeenCalledWith("custom-domain.ph", 20);
  });

  it("logs and skips non-fatally when ranked-keywords credentials are missing (disabled:true)", async () => {
    mockFetchRankedKeywords.mockResolvedValue({ disabled: true, items: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await fetchMarketIntelHandler({ profile: "shopping" });

    expect(result.errors.some((e) => e.includes("dataforseo_ranked"))).toBe(false);
    expect(mockRawSnapshot.upsert.mock.calls.some((c) => c[0].create.source === "dataforseo_ranked")).toBe(false);
    logSpy.mockRestore();
  });

  it("is non-fatal when the ranked-keywords fetch throws", async () => {
    mockFetchRankedKeywords.mockRejectedValue(new Error("dataforseo down"));

    const result = await fetchMarketIntelHandler({ profile: "shopping" });

    expect(result.errors.some((e) => e.includes("dataforseo_ranked"))).toBe(true);
  });

  it("fetches a wider candidate set (take 10) of active competitors with a non-null domain", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockCompetitor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, domain: { not: null } }, take: 10 })
    );
  });

  it("caps intersection API calls at 3 usable-domain competitors", async () => {
    mockCompetitor.findMany.mockResolvedValue([
      competitorRow({ id: "c1", name: "A", domain: "a.example" }),
      competitorRow({ id: "c2", name: "B", domain: "b.example" }),
      competitorRow({ id: "c3", name: "C", domain: "c.example" }),
      competitorRow({ id: "c4", name: "D", domain: "d.example" }),
    ]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchDomainIntersection).toHaveBeenCalledTimes(3);
    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "a.example", 20);
    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "b.example", 20);
    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "c.example", 20);
  });

  it("strips protocol/www/path from competitor domains before calling the intersection API", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow({ domain: "https://www.rival.example/some/path?q=1" })]);
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "rival.example", 20);
  });

  it("skips competitors without a usable domain", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow({ domain: null }), competitorRow({ domain: "  " })]);
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchDomainIntersection).not.toHaveBeenCalled();
  });

  it("does not let an unusable domain waste one of the 3 metered slots — later valid competitors fill it", async () => {
    // A's domain is non-null but unusable (whitespace) — B, C, D must all be attempted.
    mockCompetitor.findMany.mockResolvedValue([
      competitorRow({ id: "c1", name: "A", domain: "   " }),
      competitorRow({ id: "c2", name: "B", domain: "b.example" }),
      competitorRow({ id: "c3", name: "C", domain: "c.example" }),
      competitorRow({ id: "c4", name: "D", domain: "d.example" }),
    ]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockFetchDomainIntersection).toHaveBeenCalledTimes(3);
    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "b.example", 20);
    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "c.example", 20);
    expect(mockFetchDomainIntersection).toHaveBeenCalledWith("agrikoph.com", "d.example", 20);
  });

  it("writes a dataforseo_keyword_gap RawSnapshot when at least one competitor has results", async () => {
    mockCompetitor.findMany.mockResolvedValue([competitorRow()]);
    mockFetchDomainIntersection.mockResolvedValue({ items: [gapItem()] });

    await fetchMarketIntelHandler({ profile: "shopping" });

    const gapCall = mockRawSnapshot.upsert.mock.calls.find((c) => c[0].create.source === "dataforseo_keyword_gap");
    expect(gapCall).toBeDefined();
    expect(gapCall![0].create.payload.competitors).toHaveLength(1);
  });

  describe("keyword_gap insight thresholds", () => {
    beforeEach(() => {
      mockCompetitor.findMany.mockResolvedValue([competitorRow()]);
    });

    it("creates a keyword_gap insight when competitor ranks top-10 and volume >= 100", async () => {
      mockFetchDomainIntersection.mockResolvedValue({ items: [gapItem({ competitorPosition: 8, searchVolume: 100 })] });

      await fetchMarketIntelHandler({ profile: "shopping" });

      const insightCall = mockMarketInsight.create.mock.calls.find((c) => c[0].data.type === "keyword_gap");
      expect(insightCall).toBeDefined();
    });

    it("does not create an insight when competitor position is outside top-10", async () => {
      mockFetchDomainIntersection.mockResolvedValue({ items: [gapItem({ competitorPosition: 11 })] });

      await fetchMarketIntelHandler({ profile: "shopping" });

      expect(mockMarketInsight.create.mock.calls.some((c) => c[0].data.type === "keyword_gap")).toBe(false);
    });

    it("does not create an insight when search volume is below 100", async () => {
      mockFetchDomainIntersection.mockResolvedValue({ items: [gapItem({ searchVolume: 99 })] });

      await fetchMarketIntelHandler({ profile: "shopping" });

      expect(mockMarketInsight.create.mock.calls.some((c) => c[0].data.type === "keyword_gap")).toBe(false);
    });

    it("caps keyword_gap insights at 10 per run", async () => {
      const items = Array.from({ length: 15 }, (_, i) => gapItem({ keyword: `kw-${i}` }));
      mockFetchDomainIntersection.mockResolvedValue({ items });

      await fetchMarketIntelHandler({ profile: "shopping" });

      const insightCalls = mockMarketInsight.create.mock.calls.filter((c) => c[0].data.type === "keyword_gap");
      expect(insightCalls).toHaveLength(10);
    });

    it("dedupes by keyword against an existing OPEN keyword_gap insight", async () => {
      mockFetchDomainIntersection.mockResolvedValue({ items: [gapItem()] });
      mockMarketInsight.findFirst.mockResolvedValue({ id: "existing-open" });

      await fetchMarketIntelHandler({ profile: "shopping" });

      expect(mockMarketInsight.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "keyword_gap", status: "open" }),
        })
      );
      expect(mockMarketInsight.create.mock.calls.some((c) => c[0].data.type === "keyword_gap")).toBe(false);
    });
  });
});
