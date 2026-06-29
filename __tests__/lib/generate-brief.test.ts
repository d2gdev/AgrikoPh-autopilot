import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    competitorAd: { findMany: vi.fn().mockResolvedValue([]) },
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
  getAiClient: vi.fn().mockResolvedValue({
    model: "test-model",
    client: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  adsActivity: "No new ads this week.",
                  pricingMovements: "Prices stable.",
                  opportunities: "No competitors running educational content.",
                  recommendedActions: [
                    { priority: "low", action: "Monitor pricing", reason: "Stable market." }
                  ],
                }),
              },
            }],
          }),
        },
      },
    },
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
    const { getAiClient } = await import("@/lib/ai/client");
    vi.mocked(getAiClient).mockResolvedValueOnce({
      model: "test-model",
      provider: "deepseek",
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "not json at all" } }],
            }),
          },
        },
      } as never,
    });
    const { generateBrief } = await import("@/lib/market-intel/generate-brief");
    const result = await generateBrief();
    expect(result.adsActivity).toContain("unavailable");
  });
});
