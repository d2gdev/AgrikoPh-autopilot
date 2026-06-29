import { describe, it, expect, vi, beforeEach } from "vitest";

// executor.ts uses dynamic imports, so we use vi.doMock before importing the module.
// vi.mock hoisting won't intercept dynamic import() calls — vi.doMock runs at call time.
const mockExecuteGoogleAdsAction = vi.fn().mockResolvedValue({ success: true });
const mockExecuteMetaAction = vi.fn().mockResolvedValue({ success: true });

vi.doMock("@/lib/connectors/google-ads", () => ({
  executeGoogleAdsAction: mockExecuteGoogleAdsAction,
  fetchGoogleAdsData: vi.fn().mockResolvedValue({}),
}));

vi.doMock("@/lib/connectors/meta", () => ({
  executeMetaAction: mockExecuteMetaAction,
  fetchMetaData: vi.fn().mockResolvedValue({}),
}));

// Import AFTER mocks are registered
const { executeRecommendation } = await import("@/lib/executor");

// Minimal recommendation shape matching Prisma Recommendation type
const baseRec = {
  id: "rec-1",
  platform: "meta" as const,
  actionType: "pause_campaign",
  targetEntityId: "camp-1",
  targetEntityType: "campaign",
  targetEntityName: "Test Campaign",
  proposedValue: null,
  currentValue: null,
  changePercent: null,
  status: "approved" as const,
  skillId: "skill-1",
  shopDomain: "test.myshopify.com",
  rationale: "Test",
  confidence: 0.9,
  confidenceScore: 0.9,
  estimatedImpact: null,
  overrideJustification: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  approvedAt: null,
  approvedBy: null,
  executedAt: null,
  failureReason: null,
  conversionCount: 10,
  dailyBudgetPhp: 500,
};

describe("executeRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteGoogleAdsAction.mockResolvedValue({ success: true });
    mockExecuteMetaAction.mockResolvedValue({ success: true });
  });

  it("routes meta platform to executeMetaAction", async () => {
    const rec = { ...baseRec, platform: "meta" as const };
    await executeRecommendation(rec as any);
    expect(mockExecuteMetaAction).toHaveBeenCalledWith(rec);
    expect(mockExecuteGoogleAdsAction).not.toHaveBeenCalled();
  });

  it("routes google_ads platform to executeGoogleAdsAction", async () => {
    const rec = { ...baseRec, platform: "google_ads" as const };
    await executeRecommendation(rec as any);
    expect(mockExecuteGoogleAdsAction).toHaveBeenCalledWith(rec);
    expect(mockExecuteMetaAction).not.toHaveBeenCalled();
  });

  it("throws on unknown platform", async () => {
    const rec = { ...baseRec, platform: "unknown_platform" as any };
    await expect(executeRecommendation(rec as any)).rejects.toThrow(/unknown_platform/i);
  });

  it("returns the result from the meta connector", async () => {
    mockExecuteMetaAction.mockResolvedValueOnce({ paused: true, campaignId: "camp-1" });
    const result = await executeRecommendation({ ...baseRec, platform: "meta" } as any);
    expect(result).toEqual({ paused: true, campaignId: "camp-1" });
  });

  it("returns the result from the google_ads connector", async () => {
    mockExecuteGoogleAdsAction.mockResolvedValueOnce({ updated: true, adGroupId: "ag-42" });
    const result = await executeRecommendation({ ...baseRec, platform: "google_ads" } as any);
    expect(result).toEqual({ updated: true, adGroupId: "ag-42" });
  });
});
