import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    competitorAd: { findMany: vi.fn().mockResolvedValue([]) },
    competitorAdCapture: { findMany: vi.fn().mockResolvedValue([]) },
    shoppingPriceHistory: { findMany: vi.fn().mockResolvedValue([]) },
    marketInsight: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/content-pilot/brand-guidelines", () => ({
  getBrandGuidelines: vi.fn().mockResolvedValue("Agriko sells organic farm products."),
}));

vi.mock("@/lib/shopify-admin", () => ({
  shopifyFetch: vi.fn().mockResolvedValue({
    products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
  }),
}));

vi.mock("@/lib/ai/client", () => ({
  chatCompletionWithFailover: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      adsActivity: "No new ads this week.",
      pricingMovements: "Prices stable.",
      opportunities: "No competitors running educational content.",
      recommendedActions: [
        { priority: "low", action: "Monitor pricing", reason: "Stable market." }
      ],
    }),
    provider: "deepseek",
    model: "test-model",
  }),
}));

describe("generateBrief", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns BriefSections with all required keys", async () => {
    const { generateBrief } = await import("@/lib/market-intel/generate-brief");
    const result = await generateBrief();
    expect(result).toHaveProperty("adsActivity");
    expect(result).toHaveProperty("pricingMovements");
    expect(result).toHaveProperty("opportunities");
    expect(result).toHaveProperty("recommendedActions");
    expect(result).toHaveProperty("generatedAt");
    expect(Array.isArray(result.recommendedActions)).toBe(true);
  });

  it("returns fallback when AI returns malformed JSON", async () => {
    const { chatCompletionWithFailover } = await import("@/lib/ai/client");
    vi.mocked(chatCompletionWithFailover).mockResolvedValueOnce({
      content: "not json at all", provider: "deepseek", model: "test-model",
    });
    const { generateBrief } = await import("@/lib/market-intel/generate-brief");
    const result = await generateBrief();
    expect(result.adsActivity).toContain("unavailable");
  });

  it("includes a genuine zero price-delta percentage instead of dropping it as null", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.shoppingPriceHistory.findMany).mockResolvedValueOnce([
      {
        title: "Organic Ginger", store: "CompetitorStore", price: 199, previousPrice: 199,
        priceDelta: 0.01, priceDeltaPct: 0, currency: "PHP", marketKeyword: { keyword: "ginger" },
      },
    ] as never);

    const { chatCompletionWithFailover } = await import("@/lib/ai/client");
    const aiMock = vi.mocked(chatCompletionWithFailover);
    aiMock.mockResolvedValueOnce({
      content: JSON.stringify({ adsActivity: "x", pricingMovements: "x", opportunities: "x", recommendedActions: [] }),
      provider: "deepseek", model: "test-model",
    });

    const { generateBrief } = await import("@/lib/market-intel/generate-brief");
    await generateBrief();

    const call = aiMock.mock.calls[0];
    if (!call) throw new Error("expected chatCompletionWithFailover to have been called");
    const userMessageContent = (call[0].messages[1] as { content: string }).content;
    const context = JSON.parse(userMessageContent);
    expect(context.priceMovements[0].deltaPct).toBe(0);
  });
});

describe("fetchOurProducts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns already-fetched pages when a later page fails, instead of discarding everything", async () => {
    const { shopifyFetch } = await import("@/lib/shopify-admin");
    vi.mocked(shopifyFetch)
      .mockResolvedValueOnce({
        products: {
          edges: [{ node: { title: "Organic Black Rice", priceRangeV2: { minVariantPrice: { amount: "250", currencyCode: "PHP" } } } }],
          pageInfo: { hasNextPage: true, endCursor: "cursor1" },
        },
      } as never)
      .mockRejectedValueOnce(new Error("Shopify API timeout"));

    const { fetchOurProducts } = await import("@/lib/market-intel/generate-brief");
    const result = await fetchOurProducts();
    expect(result).toEqual([{ title: "Organic Black Rice", price: 250, currency: "PHP" }]);
  });
});
