import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level mock — hoisted to top of file by vitest
vi.mock("@/lib/db", () => ({
  prisma: {
    guardrailConfig: {
      findMany: vi.fn(),
    },
  },
}));

import { checkGuardrails } from "@/lib/guardrails";
import { prisma } from "@/lib/db";

// Default threshold rows — mirrors the DB defaults used in guardrails.ts
const DEFAULT_CONFIGS = [
  { key: "HARD_BLOCK_BID_CHANGE_PCT", value: "50" },
  { key: "HARD_BLOCK_BUDGET_CHANGE_PCT", value: "200" },
  { key: "HARD_BLOCK_MIN_CONVERSIONS", value: "10" },
  { key: "HARD_BLOCK_PAUSE_DAILY_BUDGET", value: "10000" },
  { key: "SOFT_FLAG_CHANGE_PCT", value: "30" },
  { key: "SOFT_FLAG_PAUSE_DAILY_BUDGET", value: "200" },
  { key: "SOFT_FLAG_MIN_CONFIDENCE", value: "0.5" },
];

const findMany = prisma.guardrailConfig.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Reset cache between tests by manipulating module-level state via re-import is not
  // straightforward, so we force a fresh cache each time by using vi.resetModules in
  // describe blocks that need it. For most tests the cache state doesn't matter as long
  // as findMany is set up before the first call.
  findMany.mockResolvedValue(DEFAULT_CONFIGS);
});

describe("checkGuardrails", () => {
  it("returns clear for a normal recommendation within all thresholds", async () => {
    const result = await checkGuardrails({
      actionType: "change_bid",
      targetEntityType: "ad_set",
      targetEntityId: "123",
      targetEntityName: "Test Ad Set",
      changePercent: 10,
      confidenceScore: 0.9,
      conversionCount: 50,
    });
    expect(result.status).toBe("clear");
  });

  it("returns hard_block when bid change % exceeds HARD_BLOCK_BID_CHANGE_PCT (50%)", async () => {
    const result = await checkGuardrails({
      actionType: "change_bid",
      targetEntityType: "ad_set",
      targetEntityId: "123",
      targetEntityName: "Test Ad Set",
      changePercent: 75,
      confidenceScore: 0.9,
      conversionCount: 50,
    });
    expect(result.status).toBe("hard_block");
    if (result.status === "hard_block") {
      expect(result.reason).toMatch(/75\.0%/);
      expect(result.reason).toMatch(/hard limit/);
    }
  });

  it("returns hard_block when budget change % exceeds HARD_BLOCK_BUDGET_CHANGE_PCT (200%)", async () => {
    const result = await checkGuardrails({
      actionType: "adjust_budget",
      targetEntityType: "campaign",
      targetEntityId: "456",
      targetEntityName: "Test Campaign",
      changePercent: 250,
      confidenceScore: 0.9,
      conversionCount: 50,
    });
    expect(result.status).toBe("hard_block");
    if (result.status === "hard_block") {
      expect(result.reason).toMatch(/250\.0%/);
    }
  });

  it("returns hard_block for pause_campaign with low conversion count (< 10)", async () => {
    const result = await checkGuardrails({
      actionType: "pause_campaign",
      targetEntityType: "campaign",
      targetEntityId: "789",
      targetEntityName: "Low-Conv Campaign",
      changePercent: 0,
      confidenceScore: 0.9,
      conversionCount: 3,
      dailyBudgetPhp: 500,
    });
    expect(result.status).toBe("hard_block");
    if (result.status === "hard_block") {
      expect(result.reason).toMatch(/3 conversions/);
    }
  });

  it("returns clear for add_negative_keyword with low conversion count — NOT blocked", async () => {
    // Structural actions like add_negative_keyword are excluded from CONVERSION_SENSITIVE_ACTIONS
    const result = await checkGuardrails({
      actionType: "add_negative_keyword",
      targetEntityType: "keyword",
      targetEntityId: "kw-1",
      targetEntityName: "irrelevant keyword",
      changePercent: 0,
      confidenceScore: 0.9,
      conversionCount: 1, // below hard block threshold but should be ignored
    });
    expect(result.status).toBe("clear");
  });

  it("returns soft_flag when change % exceeds SOFT_FLAG_CHANGE_PCT (30%)", async () => {
    const result = await checkGuardrails({
      actionType: "change_bid",
      targetEntityType: "ad_set",
      targetEntityId: "123",
      targetEntityName: "Test Ad Set",
      changePercent: 40,
      confidenceScore: 0.9,
      conversionCount: 50,
    });
    expect(result.status).toBe("soft_flag");
    if (result.status === "soft_flag") {
      expect(result.reason).toMatch(/40\.0%/);
      expect(result.reason).toMatch(/soft threshold/);
    }
  });

  it("returns soft_flag when confidence score is below SOFT_FLAG_MIN_CONFIDENCE (0.5)", async () => {
    const result = await checkGuardrails({
      actionType: "change_bid",
      targetEntityType: "ad_set",
      targetEntityId: "123",
      targetEntityName: "Test Ad Set",
      changePercent: 5,
      confidenceScore: 0.3,
      conversionCount: 50,
    });
    expect(result.status).toBe("soft_flag");
    if (result.status === "soft_flag") {
      expect(result.reason).toMatch(/Low confidence/);
    }
  });
});

describe("checkGuardrails — threshold cache", () => {
  it("uses cached thresholds on second call (findMany called only once per TTL window)", async () => {
    // The module-level cache persists across calls within a TTL window.
    // After beforeEach sets up findMany, two calls within a short span should
    // only trigger one DB fetch (the second hits the in-memory cache).
    const callCount = findMany.mock.calls.length;

    const rec = {
      actionType: "change_bid",
      targetEntityType: "ad_set",
      targetEntityId: "123",
      targetEntityName: "Test Ad Set",
      changePercent: 10,
      confidenceScore: 0.9,
      conversionCount: 50,
    };

    await checkGuardrails(rec);
    await checkGuardrails(rec);

    // findMany should have been called at most once more than before (cache hit on 2nd)
    const newCalls = findMany.mock.calls.length - callCount;
    expect(newCalls).toBeLessThanOrEqual(1);
  });
});
