import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  competitorAd: { findMany: vi.fn(), update: vi.fn() },
  competitorAdCapture: { findMany: vi.fn(), update: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockCreate = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  getAiClient: vi.fn().mockResolvedValue({
    model: "test-model",
    client: { chat: { completions: { create: mockCreate } } },
  }),
}));

const { classifyAnglesBatch, fillCreativeAngles } = await import("@/lib/market-intel/classify-angles");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.competitorAd.findMany.mockResolvedValue([]);
  mockPrisma.competitorAdCapture.findMany.mockResolvedValue([]);
});

describe("classifyAnglesBatch", () => {
  it("marks entries ok on a successful classification", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(["discount"]) } }],
    });
    const result = await classifyAnglesBatch(["50% off today only"]);
    expect(result).toEqual([{ angle: "discount", ok: true }]);
  });

  it("marks entries NOT ok when the AI call throws, so callers can skip persisting the 'other' fallback", async () => {
    mockCreate.mockRejectedValue(new Error("AI provider unavailable"));
    const result = await classifyAnglesBatch(["some ad copy"]);
    expect(result).toEqual([{ angle: "other", ok: false }]);
  });
});

describe("fillCreativeAngles", () => {
  it("does not write creativeAngle when classification fails, so the row stays eligible for retry", async () => {
    mockPrisma.competitorAd.findMany.mockResolvedValue([
      { id: "ad1", adCopy: "some ad copy", adCopyEn: null, headline: null, headlineEn: null },
    ]);
    mockCreate.mockRejectedValue(new Error("AI provider unavailable"));

    const result = await fillCreativeAngles({ limit: 10 });

    expect(mockPrisma.competitorAd.update).not.toHaveBeenCalled();
    expect(result.classified).toBe(0);
  });

  it("writes creativeAngle only for rows that actually classified successfully", async () => {
    mockPrisma.competitorAd.findMany.mockResolvedValue([
      { id: "ad1", adCopy: "50% off", adCopyEn: null, headline: null, headlineEn: null },
    ]);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(["discount"]) } }],
    });

    const result = await fillCreativeAngles({ limit: 10 });

    expect(mockPrisma.competitorAd.update).toHaveBeenCalledWith({ where: { id: "ad1" }, data: { creativeAngle: "discount" } });
    expect(result.classified).toBe(1);
  });
});
