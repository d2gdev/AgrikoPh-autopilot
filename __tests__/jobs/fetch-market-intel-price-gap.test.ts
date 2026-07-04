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
      findMany: vi.fn(),
    },
    marketInsight: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    guardrailConfig: {
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
  findMany: ReturnType<typeof vi.fn>;
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
const mockGuardrailConfig = prisma.guardrailConfig as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

// De-noising math (Task 1, lib/market-intel/price-signal.ts) evaluates each of
// the trailing `minDays` day-marks with its own 7-day lookback window ending
// on that day-mark. Generating a generous 21-day daily series at a fixed
// price keeps every day-mark comfortably computable regardless of `asOf`
// (real wall-clock time, since the job always uses `new Date()`).
const DAY_MS = 24 * 60 * 60 * 1000;
function stableHistorySeries(price: number, days = 21) {
  return Array.from({ length: days }, (_, i) => ({
    price,
    capturedAt: new Date(Date.now() - i * DAY_MS),
  }));
}

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
    productKey: "rivalstore-turmeric-powder-250g",
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
  // Default trailing history: 21 days at the same price as the default
  // competitorRow() (85 vs own=100 => stable 15% gap). Tests that need a
  // different history shape (unstable, or a different gap %) override this.
  mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(85));

  mockGuardrailConfig.findMany.mockResolvedValue([]); // use built-in defaults: gapPct=10, minDays=14, outlierPct=40

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
    // own=100, competitor=95 -> 5% gap, below threshold, and the trailing
    // history confirms this isn't a transient dip — it's genuinely a small gap.
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 95 })]);
    mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(95));

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("creates a 'warning' insight when the gap is >10% and <=25%", async () => {
    // own=100, competitor=85 -> 15% gap, stable for the full trailing window.
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
    const call = mockMarketInsight.create.mock.calls[0]![0];
    expect(call.data.type).toBe("price_gap");
    expect(call.data.severity).toBe("warning");
    expect(call.data.title).toContain("Review pricing for Turmeric Powder 250g: RivalStore at ₱85 (7d median) vs ours ₱100");
  });

  it("creates a 'critical' insight when the gap is >25%", async () => {
    // own=100, competitor=70 -> 30% gap, stable for the full trailing window.
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 70 })]);
    mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(70));

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
    mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(50));

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

describe("price-gap de-noising (trailing price-history stability gate)", () => {
  it("does NOT create an insight when today's single scrape shows a gap but the trailing history does not support stability", async () => {
    // Today's raw scrape looks like a 15% gap (own=100, competitor=85), but
    // the actual trailing price-history series has been hovering at a 2% gap
    // (98 vs 100) — i.e. today's scrape is exactly the kind of single-day
    // noise the de-noising gate exists to reject.
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);
    mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(98));

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).not.toHaveBeenCalled();
  });

  it("creates exactly one insight, with smoothedPrice in evidence, when 14+ days of history show a stable gap", async () => {
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);
    mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(85));

    await fetchMarketIntelHandler({ profile: "shopping" });

    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
    const call = mockMarketInsight.create.mock.calls[0]![0];
    expect(call.data.evidence.smoothedPrice).toBe(85);
    expect(call.data.evidence.daysStable).toBeGreaterThan(0);
    expect(call.data.evidence.thresholds).toEqual({ gapPct: 10, minDays: 14, outlierPct: 40 });
    // Existing evidence fields must still be present alongside the new ones.
    expect(call.data.evidence.ownPrice).toBe(100);
    expect(call.data.evidence.competitorPrice).toBe(85);
    expect(call.data.evidence.store).toBe("RivalStore");
  });

  it("does not create a duplicate insight when the job runs a second time same day with the same stable history", async () => {
    mockShoppingResult.findMany.mockResolvedValue([competitorRow({ price: 85 })]);
    mockPriceHistory.findMany.mockResolvedValue(stableHistorySeries(85));

    // First run: no open insight yet -> creates one.
    mockMarketInsight.findFirst.mockResolvedValueOnce(null);
    await fetchMarketIntelHandler({ profile: "shopping" });
    expect(mockMarketInsight.create).toHaveBeenCalledOnce();

    // Second run same day, same stable history: the existing open-insight
    // dedup (unchanged from before this task) must find the one just created
    // and skip — no duplicate.
    mockMarketInsight.findFirst.mockResolvedValueOnce({ id: "existing-open" });
    await fetchMarketIntelHandler({ profile: "shopping" });
    expect(mockMarketInsight.create).toHaveBeenCalledOnce();
  });
});
