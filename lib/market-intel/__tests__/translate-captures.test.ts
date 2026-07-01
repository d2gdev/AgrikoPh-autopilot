import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  shoppingResult: { findMany: vi.fn(), update: vi.fn() },
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

const { translateToEnglishBatch, fillCaptureTranslations } = await import("@/lib/market-intel/translate-captures");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.shoppingResult.findMany.mockResolvedValue([]);
  mockPrisma.competitorAd.findMany.mockResolvedValue([]);
  mockPrisma.competitorAdCapture.findMany.mockResolvedValue([]);
});

describe("translateToEnglishBatch", () => {
  it("marks entries ok on a successful translation", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(["Black rice"]) } }],
    });
    const result = await translateToEnglishBatch(["Bigas na itim"]);
    expect(result).toEqual([{ text: "Black rice", ok: true }]);
  });

  it("marks entries NOT ok when the AI call throws, so callers can skip persisting a fallback", async () => {
    mockCreate.mockRejectedValue(new Error("AI provider unavailable"));
    const result = await translateToEnglishBatch(["Bigas na itim"]);
    expect(result).toEqual([{ text: "Bigas na itim", ok: false }]);
  });

  it("marks entries NOT ok when the AI response shape doesn't match the input length", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(["only one", "but two expected"]) } }],
    });
    const result = await translateToEnglishBatch(["one text"]);
    expect(result).toEqual([{ text: "one text", ok: false }]);
  });
});

describe("fillCaptureTranslations", () => {
  it("does not write titleEn when translation fails, so the row stays eligible for retry", async () => {
    mockPrisma.shoppingResult.findMany.mockResolvedValue([
      { id: "sr1", title: "Bigas na itim" },
    ]);
    mockCreate.mockRejectedValue(new Error("AI provider unavailable"));

    const result = await fillCaptureTranslations({ limit: 10 });

    expect(mockPrisma.shoppingResult.update).not.toHaveBeenCalled();
    expect(result.shopping).toBe(0);
  });

  it("writes titleEn only for rows that actually translated successfully", async () => {
    mockPrisma.shoppingResult.findMany.mockResolvedValue([
      { id: "sr1", title: "Bigas na itim" },
      { id: "sr2", title: "Luya" },
    ]);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(["Black rice", "Ginger"]) } }],
    });

    const result = await fillCaptureTranslations({ limit: 10 });

    expect(mockPrisma.shoppingResult.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.shoppingResult.update).toHaveBeenCalledWith({ where: { id: "sr1" }, data: { titleEn: "Black rice" } });
    expect(mockPrisma.shoppingResult.update).toHaveBeenCalledWith({ where: { id: "sr2" }, data: { titleEn: "Ginger" } });
    expect(result.shopping).toBe(2);
  });
});
