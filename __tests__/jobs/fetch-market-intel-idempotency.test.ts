import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    marketInsight: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    shoppingPriceHistory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    shoppingResult: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// Mock all side-effect imports so the module can load without credentials
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

import { prisma } from "@/lib/db";
import {
  saveOpenDailyMarketInsight,
  saveShoppingPriceHistory,
  saveShoppingResult,
  computeProductIdentityHash,
} from "@/jobs/fetch-market-intel";

// Typed helpers
const mockMarketInsight = prisma.marketInsight as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const mockPriceHistory = prisma.shoppingPriceHistory as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const mockShoppingResult = prisma.shoppingResult as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

// A fixed capture date for all tests
const CAPTURED_AT = new Date("2026-06-25T10:00:00.000Z");

// Minimal base data shapes
function baseInsight(overrides: Record<string, unknown> = {}) {
  return {
    type: "COMPETITOR_PRICE_CHANGE",
    competitorId: "comp-1",
    keywordId: "kw-1",
    adId: null,
    title: "Test insight",
    body: "{}",
    severity: "medium",
    ...overrides,
  } as unknown as Parameters<typeof saveOpenDailyMarketInsight>[0];
}

function basePriceHistory(overrides: Record<string, unknown> = {}) {
  return {
    productKey: "product-abc",
    capturedAt: CAPTURED_AT,
    price: 100,
    ...overrides,
  } as unknown as Parameters<typeof saveShoppingPriceHistory>[0];
}

function baseShoppingResult(overrides: Record<string, unknown> = {}) {
  return {
    keyword: "organic rice",
    productKey: "product-xyz",
    capturedAt: CAPTURED_AT,
    title: "Organic Rice 5kg",
    productUrl: "https://example.com/rice",
    store: "Example Store",
    price: 250,
    ...overrides,
  } as Parameters<typeof saveShoppingResult>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing exists in DB
  mockMarketInsight.findUnique.mockResolvedValue(null);
  mockMarketInsight.upsert.mockResolvedValue({});
  mockPriceHistory.findUnique.mockResolvedValue(null);
  mockPriceHistory.upsert.mockResolvedValue({});
  mockShoppingResult.findUnique.mockResolvedValue(null);
  mockShoppingResult.upsert.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// 1. saveOpenDailyMarketInsight — idempotency
// ---------------------------------------------------------------------------

describe("saveOpenDailyMarketInsight idempotency", () => {
  it("returns 'created' when no existing row, 'updated' when row already exists", async () => {
    // First call — nothing exists
    mockMarketInsight.findUnique.mockResolvedValueOnce(null);
    const first = await saveOpenDailyMarketInsight(baseInsight(), CAPTURED_AT);
    expect(first).toBe("created");

    // Second call — row now exists
    mockMarketInsight.findUnique.mockResolvedValueOnce({ id: "existing-id" });
    const second = await saveOpenDailyMarketInsight(baseInsight(), CAPTURED_AT);
    expect(second).toBe("updated");
  });

  it("calls upsert with a dedupeKey that includes type, competitorId, keywordId and captureDay", async () => {
    await saveOpenDailyMarketInsight(baseInsight(), CAPTURED_AT);

    expect(mockMarketInsight.upsert).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = mockMarketInsight.upsert.mock.calls[0]![0];
    const expectedDay = "2026-06-25";
    expect(call.where.dedupeKey).toBe(
      `COMPETITOR_PRICE_CHANGE|comp-1|kw-1||${expectedDay}`
    );
  });

  it("omitting the discriminator preserves the legacy 5-segment dedupeKey (no regression)", async () => {
    await saveOpenDailyMarketInsight(baseInsight(), CAPTURED_AT);
    const call = mockMarketInsight.upsert.mock.calls[0]![0];
    expect(call.where.dedupeKey).toBe("COMPETITOR_PRICE_CHANGE|comp-1|kw-1||2026-06-25");
  });

  it("price_change insights for different products under the same keyword get DISTINCT dedupeKeys (no overwrite)", async () => {
    // Reproduces the data-loss bug: same type+keyword+day, different products.
    mockMarketInsight.findUnique.mockResolvedValue(null);
    await saveOpenDailyMarketInsight(
      baseInsight({ type: "price_change", competitorId: null, keywordId: "kw-1", adId: null }),
      CAPTURED_AT,
      "product-A",
    );
    await saveOpenDailyMarketInsight(
      baseInsight({ type: "price_change", competitorId: null, keywordId: "kw-1", adId: null }),
      CAPTURED_AT,
      "product-B",
    );
    const keys = (mockMarketInsight.upsert.mock.calls as Array<[{ where: { dedupeKey: string } }]>).map(
      (c) => c[0].where.dedupeKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain("product-A");
    expect(keys[1]).toContain("product-B");
  });

  it("price_change insights for the SAME product dedupe to one key (idempotent re-run)", async () => {
    await saveOpenDailyMarketInsight(
      baseInsight({ type: "price_change", competitorId: null, keywordId: "kw-1", adId: null }),
      CAPTURED_AT,
      "product-A",
    );
    await saveOpenDailyMarketInsight(
      baseInsight({ type: "price_change", competitorId: null, keywordId: "kw-1", adId: null }),
      CAPTURED_AT,
      "product-A",
    );
    const keys = (mockMarketInsight.upsert.mock.calls as Array<[{ where: { dedupeKey: string } }]>).map(
      (c) => c[0].where.dedupeKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("creates TWO separate rows when competitorId differs (different dedupeKey)", async () => {
    // Both calls see no existing row
    mockMarketInsight.findUnique.mockResolvedValue(null);

    await saveOpenDailyMarketInsight(baseInsight({ competitorId: "comp-1" }), CAPTURED_AT);
    await saveOpenDailyMarketInsight(baseInsight({ competitorId: "comp-2" }), CAPTURED_AT);

    expect(mockMarketInsight.upsert).toHaveBeenCalledTimes(2);
    const keys = (mockMarketInsight.upsert.mock.calls as Array<[{ where: { dedupeKey: string } }]>).map(
      (c) => c[0].where.dedupeKey
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain("comp-1");
    expect(keys[1]).toContain("comp-2");
  });
});

// ---------------------------------------------------------------------------
// 2. saveShoppingPriceHistory — context isolation
// ---------------------------------------------------------------------------

describe("saveShoppingPriceHistory context isolation", () => {
  it("creates TWO rows when the same productKey+captureDate is saved under different contexts (marketKeywordId vs competitorId)", async () => {
    mockPriceHistory.findUnique.mockResolvedValue(null);

    await saveShoppingPriceHistory(
      basePriceHistory({ marketKeywordId: "kw1" })
    );
    await saveShoppingPriceHistory(
      basePriceHistory({ competitorId: "c1" })
    );

    expect(mockPriceHistory.upsert).toHaveBeenCalledTimes(2);
    const keys = (mockPriceHistory.upsert.mock.calls as Array<[{ create: { contextKey: string } }]>).map(
      (c) => c[0].create.contextKey
    );
    expect(keys[0]).toBe("market:kw1");
    expect(keys[1]).toBe("competitor:c1");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("calls upsert (not create twice) when the same productKey+captureDate+contextKey is saved twice", async () => {
    // First call — no existing row
    mockPriceHistory.findUnique.mockResolvedValueOnce(null);
    const first = await saveShoppingPriceHistory(
      basePriceHistory({ marketKeywordId: "kw1" })
    );
    expect(first).toBe("created");

    // Second call — row exists
    mockPriceHistory.findUnique.mockResolvedValueOnce({ id: "row-1" });
    const second = await saveShoppingPriceHistory(
      basePriceHistory({ marketKeywordId: "kw1" })
    );
    expect(second).toBe("updated");

    // upsert was called both times (not a raw create)
    expect(mockPriceHistory.upsert).toHaveBeenCalledTimes(2);
  });

  it("uses 'unknown' contextKey when neither marketKeywordId nor competitorId is provided", async () => {
    await saveShoppingPriceHistory(basePriceHistory());

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = mockPriceHistory.upsert.mock.calls[0]![0];
    expect(call.create.contextKey).toBe("unknown");
    expect(call.where.productKey_captureDate_contextKey.contextKey).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// 3. computeProductIdentityHash / saveShoppingResult hash computation
// ---------------------------------------------------------------------------

describe("computeProductIdentityHash", () => {
  it("returns a non-empty 16-character hex string", () => {
    const hash = computeProductIdentityHash(
      "https://example.com/rice",
      "Organic Rice 5kg",
      "Example Store"
    );
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same inputs always produce the same hash", () => {
    const url = "https://example.com/rice";
    const title = "Organic Rice 5kg";
    const store = "Example Store";

    const h1 = computeProductIdentityHash(url, title, store);
    const h2 = computeProductIdentityHash(url, title, store);
    expect(h1).toBe(h2);
  });

  it("differs when productUrl changes", () => {
    const h1 = computeProductIdentityHash("https://example.com/a", "Rice", "Store");
    const h2 = computeProductIdentityHash("https://example.com/b", "Rice", "Store");
    expect(h1).not.toBe(h2);
  });

  it("differs when title changes", () => {
    const h1 = computeProductIdentityHash("https://x.com/rice", "Organic Rice", "Store");
    const h2 = computeProductIdentityHash("https://x.com/rice", "Premium Rice", "Store");
    expect(h1).not.toBe(h2);
  });

  it("normalises case — uppercase and lowercase inputs produce the same hash", () => {
    const h1 = computeProductIdentityHash("https://Example.COM/Rice", "ORGANIC RICE", "MY STORE");
    const h2 = computeProductIdentityHash("https://example.com/rice", "organic rice", "my store");
    expect(h1).toBe(h2);
  });

  it("handles null/undefined productUrl and store gracefully", () => {
    const h1 = computeProductIdentityHash(null, "Rice", undefined);
    const h2 = computeProductIdentityHash(null, "Rice", undefined);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(h1).toBe(h2);
  });
});

describe("saveShoppingResult productIdentityHash", () => {
  it("passes a non-empty 16-char hex productIdentityHash to upsert", async () => {
    await saveShoppingResult(baseShoppingResult());

    expect(mockShoppingResult.upsert).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const call = mockShoppingResult.upsert.mock.calls[0]![0];
    expect(call.create.productIdentityHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces the same hash for the same productUrl+title+store on two separate calls", async () => {
    await saveShoppingResult(baseShoppingResult());
    await saveShoppingResult(baseShoppingResult());

    const calls = mockShoppingResult.upsert.mock.calls;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const hash1 = calls[0]![0].create.productIdentityHash;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const hash2 = calls[1]![0].create.productIdentityHash;
    expect(hash1).toBe(hash2);
  });

  it("returns 'created' on first call and 'updated' on second when same unique key", async () => {
    mockShoppingResult.findUnique.mockResolvedValueOnce(null);
    const first = await saveShoppingResult(baseShoppingResult());
    expect(first).toBe("created");

    mockShoppingResult.findUnique.mockResolvedValueOnce({ id: "row-1" });
    const second = await saveShoppingResult(baseShoppingResult());
    expect(second).toBe("updated");
  });
});
