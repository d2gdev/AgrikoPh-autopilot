import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    guardrailConfig: {
      findMany: vi.fn().mockResolvedValue([]), // empty = use defaults
    },
  },
}));

import { checkGuardrails } from "@/lib/guardrails";

// NOTE: change_bid is in CONVERSION_SENSITIVE_ACTIONS, so BASE needs enough
// conversions to avoid the low-conversion hard_block on bid-change tests.
const BASE = {
  actionType: "change_bid",
  targetEntityType: "ad_set",
  targetEntityId: "123",
  targetEntityName: "Test Ad Set",
  conversionCount: 50, // satisfies HARD_BLOCK_MIN_CONVERSIONS (default: 10)
};

describe("checkGuardrails — defaults", () => {
  // NOTE: guardrails.ts has a 5-min module-level TTL cache for thresholds.
  // vi.clearAllMocks() resets the findMany spy but not the cache.
  // All tests in this suite use the same empty-DB defaults, so cache hits
  // return consistent values. If you add tests with custom GuardrailConfig
  // values, call vi.resetModules() and re-import checkGuardrails to bypass the cache.
  beforeEach(() => vi.clearAllMocks());
  // Reset modules after each test so the 5-min TTL cache is cleared when tests
  // with custom GuardrailConfig values are added to this suite in future.
  afterEach(() => vi.resetModules());

  it("returns clear for a 10% bid change", async () => {
    const result = await checkGuardrails({ ...BASE, changePercent: 10 });
    expect(result.status).toBe("clear");
  });

  it("returns soft_flag for a 35% bid change", async () => {
    const result = await checkGuardrails({ ...BASE, changePercent: 35 });
    expect(result.status).toBe("soft_flag");
  });

  it("returns hard_block for a 55% bid change", async () => {
    const result = await checkGuardrails({ ...BASE, changePercent: 55 });
    expect(result.status).toBe("hard_block");
    expect((result as { status: "hard_block"; reason: string }).reason).toMatch(/55/);
  });

  it("hard_blocks pause_campaign with fewer than 10 conversions", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "pause_campaign",
      changePercent: 0,
      conversionCount: 5,
      dailyBudgetPhp: 100,
    });
    expect(result.status).toBe("hard_block");
  });

  it("hard_blocks pause of campaign spending > ₱10,000/day", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "pause_campaign",
      changePercent: 0,
      conversionCount: 50,
      dailyBudgetPhp: 15000,
    });
    expect(result.status).toBe("hard_block");
  });

  it("soft_flags a pause of campaign spending > ₱200/day", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "pause_campaign",
      changePercent: 0,
      conversionCount: 50,
      dailyBudgetPhp: 500,
    });
    expect(result.status).toBe("soft_flag");
  });

  it("soft_flags low confidence score", async () => {
    const result = await checkGuardrails({
      ...BASE,
      changePercent: 10,
      confidenceScore: 0.3,
    });
    expect(result.status).toBe("soft_flag");
  });

  it("returns clear for add_negative_keyword with low conversions (not conversion-sensitive)", async () => {
    const result = await checkGuardrails({
      actionType: "add_negative_keyword",
      targetEntityType: "campaign",
      targetEntityId: "456",
      targetEntityName: "Test Campaign",
      changePercent: 0,
      conversionCount: 0,
    });
    expect(result.status).toBe("clear");
  });

  it("hard-blocks adjust_budget with extreme percentage change (> 200% default limit)", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "adjust_budget",
      changePercent: 250, // exceeds hardBlockBudgetChangePct default of 200
    });
    expect(result.status).toBe("hard_block");
    expect((result as { status: "hard_block"; reason: string }).reason).toMatch(/250|budget/i);
  });

  it("allows adjust_budget within acceptable range", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "adjust_budget",
      changePercent: 20, // well under the 200% hard limit and 30% soft limit
    });
    expect(result.status).toBe("clear");
  });

  it("soft-flags adjust_budget above soft threshold but below hard limit", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "adjust_budget",
      changePercent: 35, // > softFlagChangePct (30), < hardBlockBudgetChangePct (200)
    });
    expect(result.status).toBe("soft_flag");
  });

  it("hard-blocks adjust_budget with fewer than 10 conversions (conversion-sensitive)", async () => {
    const result = await checkGuardrails({
      ...BASE,
      actionType: "adjust_budget",
      changePercent: 10,
      conversionCount: 3, // below HARD_BLOCK_MIN_CONVERSIONS default of 10
    });
    expect(result.status).toBe("hard_block");
  });
});
