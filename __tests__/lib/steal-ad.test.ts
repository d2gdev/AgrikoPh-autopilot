import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    competitorAd: {
      findUnique: vi.fn().mockResolvedValue({
        id: "ad-1",
        adCopy: "Buy our hair growth product now!",
        headline: "Regrow Your Hair",
        creativeAngle: "problem-solution",
        platforms: ["facebook"],
        pageName: "Minoxiplus",
      }),
    },
  },
}));

vi.mock("@/lib/content-pilot/brand-guidelines", () => ({
  getBrandGuidelines: vi.fn().mockResolvedValue("Agriko: natural farm products, warm Filipino tone."),
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
                  headline: "Grow Naturally with Agriko",
                  adCopy: "Our organic hair care gives you real results.",
                  cta: "Shop Now",
                  platform: "facebook",
                  suggestedContentType: "promotional",
                }),
              },
            }],
          }),
        },
      },
    },
  }),
}));

describe("generateStolenAd", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns StolenAd with all required fields", async () => {
    const { generateStolenAd } = await import("@/lib/market-intel/steal-ad");
    const result = await generateStolenAd("ad-1");
    expect(result).toHaveProperty("headline");
    expect(result).toHaveProperty("adCopy");
    expect(result).toHaveProperty("cta");
    expect(result).toHaveProperty("platform");
    expect(result).toHaveProperty("suggestedContentType");
    expect(typeof result.headline).toBe("string");
    expect(result.headline.length).toBeGreaterThan(0);
  });

  it("throws when ad is not found", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.competitorAd.findUnique).mockResolvedValueOnce(null);
    const { generateStolenAd } = await import("@/lib/market-intel/steal-ad");
    await expect(generateStolenAd("nonexistent")).rejects.toThrow("Ad not found");
  });
});
