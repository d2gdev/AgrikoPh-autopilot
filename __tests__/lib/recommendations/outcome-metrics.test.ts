import { describe, it, expect } from "vitest";
import { findEntityMetrics, computeOutcome } from "@/lib/recommendations/outcome-metrics";

describe("findEntityMetrics", () => {
  it("reads metrics directly off a campaign entity with inline fields (no nested insights)", () => {
    const payload = {
      campaigns: [
        { id: "123", name: "Brand", spend: 100, roas: 3.2, conversions: 10 },
        { id: "456", name: "Other", spend: 50 },
      ],
    };
    const metrics = findEntityMetrics(payload, "campaign", "123");
    expect(metrics).toEqual({ spend: 100, roas: 3.2, conversions: 10 });
  });

  it("aggregates meta insights rows by campaign_id when the entity object carries no metrics", () => {
    const payload = {
      campaigns: [{ id: "999", name: "Meta Campaign", status: "ACTIVE" }],
      insights: [
        { campaign_id: "999", ad_id: "1", spend: "10.5", clicks: "20", impressions: "1000", actions: [{ action_type: "purchase", value: "2" }] },
        { campaign_id: "999", ad_id: "2", spend: "5.5", clicks: "10", impressions: "500", actions: [] },
        { campaign_id: "other", ad_id: "3", spend: "999", clicks: "1", impressions: "1" },
      ],
    };
    const metrics = findEntityMetrics(payload, "campaign", "999");
    expect(metrics?.spend).toBeCloseTo(16);
    expect(metrics?.ctr).toBeCloseTo(30 / 1500);
    expect(metrics?.conversions).toBeCloseTo(2);
    expect(metrics?.cpa).toBeCloseTo(8);
  });

  it("returns undefined when the payload has no matching arrays at all", () => {
    expect(findEntityMetrics({}, "campaign", "123")).toBeUndefined();
    expect(findEntityMetrics({ campaigns: [] }, "campaign", "123")).toBeUndefined();
  });

  it("returns undefined when the entity vanished from the payload (no id match, no insights match)", () => {
    const payload = { campaigns: [{ id: "1", spend: 5 }], insights: [{ campaign_id: "1", spend: "5" }] };
    expect(findEntityMetrics(payload, "campaign", "999")).toBeUndefined();
  });

  it("tolerates malformed rows (non-object entries, missing fields) without throwing", () => {
    const payload = {
      campaigns: [null, "not an object", { id: "1" }],
      insights: [null, 42, { campaign_id: "1" }],
    };
    expect(() => findEntityMetrics(payload, "campaign", "1")).not.toThrow();
  });

  it("returns undefined for a null/non-object payload", () => {
    expect(findEntityMetrics(null, "campaign", "1")).toBeUndefined();
    expect(findEntityMetrics(undefined, "campaign", "1")).toBeUndefined();
    expect(findEntityMetrics("string", "campaign", "1")).toBeUndefined();
  });

  it("returns undefined when targetEntityId is missing", () => {
    expect(findEntityMetrics({ campaigns: [{ id: "1" }] }, "campaign", null)).toBeUndefined();
    expect(findEntityMetrics({ campaigns: [{ id: "1" }] }, "campaign", undefined)).toBeUndefined();
  });

  it("falls back across adSets/adGroups for ad_set entity type", () => {
    const payload = { adGroups: [{ id: "77", spend: 3, conversions: 1 }] };
    expect(findEntityMetrics(payload, "ad_set", "77")).toEqual({ spend: 3, conversions: 1 });
  });
});

describe("computeOutcome", () => {
  it("verdicts improved when ROAS is >5% better", () => {
    const result = computeOutcome({ roas: 2.0 }, { roas: 2.2 });
    expect(result.verdict).toBe("improved");
    expect(result.primaryMetric).toBe("roas");
  });

  it("verdicts worsened when ROAS is >5% worse", () => {
    const result = computeOutcome({ roas: 2.0 }, { roas: 1.8 });
    expect(result.verdict).toBe("worsened");
  });

  it("verdicts neutral when ROAS change is within 5%", () => {
    const result = computeOutcome({ roas: 2.0 }, { roas: 2.05 });
    expect(result.verdict).toBe("neutral");
  });

  it("prefers ROAS over CPA and CTR when all are present", () => {
    // ROAS improved, CPA worsened — ROAS should win since it's checked first.
    const result = computeOutcome({ roas: 2.0, cpa: 100, ctr: 0.02 }, { roas: 2.5, cpa: 200, ctr: 0.01 });
    expect(result.primaryMetric).toBe("roas");
    expect(result.verdict).toBe("improved");
  });

  it("falls back to CPA when ROAS is absent, and treats lower CPA as improved", () => {
    const result = computeOutcome({ cpa: 100 }, { cpa: 80 });
    expect(result.primaryMetric).toBe("cpa");
    expect(result.verdict).toBe("improved");
  });

  it("falls back to CTR when ROAS and CPA are absent", () => {
    const result = computeOutcome({ ctr: 0.02 }, { ctr: 0.03 });
    expect(result.primaryMetric).toBe("ctr");
    expect(result.verdict).toBe("improved");
  });

  it("is insufficient_data when before metrics are missing", () => {
    const result = computeOutcome(undefined, { roas: 2.0 });
    expect(result.verdict).toBe("insufficient_data");
  });

  it("is insufficient_data when after metrics are missing", () => {
    const result = computeOutcome({ roas: 2.0 }, undefined);
    expect(result.verdict).toBe("insufficient_data");
  });

  it("is insufficient_data when there is no metric shared by both sides", () => {
    const result = computeOutcome({ spend: 10 }, { spend: 20 });
    expect(result.verdict).toBe("insufficient_data");
  });

  it("is insufficient_data instead of dividing by zero when the baseline primary metric is zero", () => {
    const result = computeOutcome({ roas: 0 }, { roas: 5 });
    expect(result.verdict).toBe("insufficient_data");
  });

  it("computes deltas for every metric present on both sides, skipping one-sided metrics", () => {
    const result = computeOutcome({ spend: 100, roas: 2, conversions: 5 }, { spend: 150, roas: 2.5 });
    expect(result.deltas.spend).toEqual({ before: 100, after: 150, deltaPercent: 50 });
    expect(result.deltas.roas).toEqual({ before: 2, after: 2.5, deltaPercent: 25 });
    expect(result.deltas.conversions).toBeUndefined();
  });
});
