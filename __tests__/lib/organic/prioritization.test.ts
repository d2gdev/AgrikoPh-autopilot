import { describe, expect, it } from "vitest";

import { scoreOrganicOpportunity } from "@/lib/organic/prioritization";

describe("scoreOrganicOpportunity", () => {
  it("scores high-impression CTR gaps above low-volume metadata fixes", () => {
    const ctrGap = scoreOrganicOpportunity({
      type: "ctr_gap",
      impressions: 2000,
      clicks: 20,
      position: 8,
      expectedCtr: 0.05,
      confidence: 0.85,
      effort: "low",
      businessRelevance: "high",
      sourceFreshnessHours: 24,
    });
    const metadata = scoreOrganicOpportunity({
      type: "metadata_fix",
      impressions: 30,
      confidence: 0.9,
      effort: "low",
      businessRelevance: "medium",
      sourceFreshnessHours: 24,
    });

    expect(ctrGap.score).toBeGreaterThan(metadata.score);
    expect(ctrGap.priority).toMatch(/P0|P1/);
  });

  it("penalizes stale data and high effort", () => {
    const fresh = scoreOrganicOpportunity({
      type: "new_content",
      searchVolume: 1000,
      confidence: 0.8,
      effort: "medium",
      sourceFreshnessHours: 24,
    });
    const stale = scoreOrganicOpportunity({
      type: "new_content",
      searchVolume: 1000,
      confidence: 0.8,
      effort: "high",
      sourceFreshnessHours: 400,
    });

    expect(fresh.score).toBeGreaterThan(stale.score);
  });
});
