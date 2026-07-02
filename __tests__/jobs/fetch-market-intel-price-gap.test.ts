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
import { fetchMarketIntelHandler } from "@/jobs/fetch-market-intel";

const mockJobRun = prisma.jobRun as unknown as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
};
const mockMarketKeyword = prisma.marketKeyword as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
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
const mockSocialPage = prisma.competitorSocialPage as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockRawSnapshot = prisma.rawSnapshot as unknown as {
  upsert: ReturnType<typeof vi.fn>;
};

const mockResolveRunLimits = resolveRunLimits as unknown as ReturnType<typeof vi.fn>;
const mockFetchSerper = fetchSerperShoppingProducts as unknown as ReturnType<typeof vi.fn>;
const mockFetchCatalog = fetchCatalogProducts as unknown as ReturnType<typeof vi.fn>;

const TURMERIC_KEYWORD = {
  id: "kw-turmeric",
  keyword: "turmeric powder",
  category: null,
  locationName: null,
  languageCode: "en",
  active: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

function ownCatalogProduct(overrides: Partial<{ id: string; title: string; handle: string; price: string }> = {}) {
  return {
    id: overrides.id ?? "gid://shopify/Product/1",
    title: overrides.title ?? "Turmeric Powder 250g",
    handle: overrides.handle ?? "turmeric-powder-250g",
    variants: [
      { id: "v1", title: "Default", price: overrides.price ?? "100.00", compareAtPrice: null },
    ],
  };
}

function competitorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sr-1",
    keyword: "turmeric powder",
    title: "Turmeric Powder 250g",
    store: "RivalStore",
    price: 85,
    currency: "PHP",
    productUrl: "https://rival.example/turmeric",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockResolveRunLimits.mockReturnValue({
    keywordLimit: 5,
    shoppingResultLimit: 5,
    competitorPageLimit: 0,
    adLimitPerPage: 0,
    longRunningAdDays: 30,
    sources: ["shopping"],
  });

  mockJobRun.create.mockResolvedValue({ id: "run-1" });
  mockJobRun.update.mockResolvedValue({});
  mockJobRun.findUnique.mockResolvedValue({ id: "run-1", jobName: "fetch-market-intel" });

  mockMarketKeyword.findMany.mockResolvedValue([TURMERIC_KEYWORD]);

  mockFetchSerper.mockResolvedValue({ disabled: false, products: [] });

  mockShoppingResult.findUnique.mockResolvedValue(null);
  mockShoppingResult.upsert.mockResolvedValue({});
  // Simulate "already pulled competitor shopping this week" so the competitor
  // catalog pull branch is skipped — irrelevant to price-gap detection.
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

  mockFetchCatalog.mockResolvedValue([ownCatalogProduct()]);
});

describe("shopify_catalog RawSnapshot ingestion", () => {
  it("upserts a RawSnapshot with source shopify_catalog and start===end (capture day)", async () => {
    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockRawSnapshot.upsert).toHaveBeenCalledOnce();
    const call = mockRawSnapshot.upsert.mock.calls[0]![0];
    expect(call.create.source).toBe("shopify_catalog");
    expect(call.create.dateRangeStart).toEqual(call.create.dateRangeEnd);
  });

  it("is non-fatal when the catalog fetch throws — job continues and records the error", async () => {
    mockFetchCatalog.mockRejectedValue(new Error("shopify down"));

    const result = await fetchMarketIntelHandler({ profile: "shopping" });

    expect(result.errors.some((e) => e.includes("shopify_catalog"))).toBe(true);
    // Rest of the run still executed: keyword shopping loop ran.
    expect(mockFetchSerper).toHaveBeenCalled();
    // No RawSnapshot write since the fetch itself failed.
    expect(mockRawSnapshot.upsert).not.toHaveBeenCalled();
    // No price-gap insights possible with an empty catalog.
    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });
});

describe("price-gap matching", () => {
  it("matches own product whose title contains the keyword, case-insensitively", async () => {
    mockFetchCatalog.mockResolvedValue([ownCatalogProduct({ title: "TURMERIC Powder 250g Organic" })]);
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
  });

  it("does not match when the product title does not contain the keyword", async () => {
    mockFetchCatalog.mockResolvedValue([ownCatalogProduct({ title: "Brown Rice 5kg" })]);
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("uses the cheapest variant price when a product has multiple variants, and records that in evidence", async () => {
    mockFetchCatalog.mockResolvedValue([{
      id: "gid://shopify/Product/2",
      title: "Turmeric Powder",
      handle: "turmeric-powder",
      variants: [
        { id: "v1", title: "250g", price: "150.00", compareAtPrice: null },
        { id: "v2", title: "500g", price: "100.00", compareAtPrice: null },
      ],
    }]);
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
    const call = mockMarketInsight.create.mock.calls[0]![0];
    expect(call.data.evidence.ownPrice).toBe(100);
    expect(call.data.evidence.ownPriceNote).toMatch(/cheapest variant/i);
  });

  it("skips a competitor row with a zero or unparseable price", async () => {
    mockShoppingResult.findMany.mockResolvedValue([
      competitorRow({ id: "sr-zero", price: 0 }),
      competitorRow({ id: "sr-null", price: null }),
    ]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("skips an own product with a zero or unparseable variant price", async () => {
    mockFetchCatalog.mockResolvedValue([{
      id: "gid://shopify/Product/3",
      title: "Turmeric Powder",
      handle: "turmeric-powder",
      variants: [{ id: "v1", title: "Default", price: "not-a-number", compareAtPrice: null }],
    }]);
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });
});

describe("price-gap threshold and severity", () => {
  it("does not create an insight when the gap is <=10%", async () => {
    // own=100, competitor=95 -> 5% gap, below threshold
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 95 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("creates a 'warning' insight when the gap is >10% and <=25%", async () => {
    // own=100, competitor=85 -> 15% gap
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
    const call = mockMarketInsight.create.mock.calls[0]![0];
    expect(call.data.type).toBe("price_gap");
    expect(call.data.severity).toBe("warning");
    expect(call.data.title).toBe("RivalStore undercuts Turmeric Powder 250g by 15%");
  });

  it("creates a 'critical' insight when the gap is >25%", async () => {
    // own=100, competitor=70 -> 30% gap
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 70 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
    const call = mockMarketInsight.create.mock.calls[0]![0];
    expect(call.data.severity).toBe("critical");
  });
});

describe("price-gap own-listing exclusion", () => {
  it("does not create a price_gap insight when the ShoppingResult store is Agriko's own listing", async () => {
    // own=100, "competitor" store is actually Agriko's own storefront at 50 -> would be a 50% gap if not excluded.
    mockShoppingResult.findMany.mockResolvedValue([
      competitorRow({ store: "Agriko Official Store", price: 50 }),
    ]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("does not create a price_gap insight when the ShoppingResult productUrl is on the own domain", async () => {
    mockShoppingResult.findMany.mockResolvedValue([
      competitorRow({ store: "SomeMarketplaceStore", price: 50, productUrl: "https://www.agrikoph.com/products/turmeric-powder" }),
    ]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("still creates a price_gap insight for a genuine competitor row", async () => {
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 50 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
  });
});

describe("price-gap dedup", () => {
  it("skips creating a new insight when an OPEN price_gap insight already exists for the same keyword+store", async () => {
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);
    mockMarketInsight.findFirst.mockResolvedValue({ id: "existing-open" });

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.findFirst).toHaveBeenCalled();
    const findFirstArgs = mockMarketInsight.findFirst.mock.calls[0]![0];
    expect(findFirstArgs.where.type).toBe("price_gap");
    expect(findFirstArgs.where.status).toBe("open");
    expect(findFirstArgs.where.keywordId).toBe("kw-turmeric");
    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("creates a new insight when no OPEN price_gap insight exists (e.g. previous one was resolved)", async () => {
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);
    mockMarketInsight.findFirst.mockResolvedValue(null);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
  });
});
