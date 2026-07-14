import { describe, expect, it } from "vitest";

import {
  evaluateTopicalMapGscMetrics,
  topicalMapGscWindows,
} from "@/lib/recommendations/topical-map-outcome";

const metrics = (
  clicks: number,
  impressions: number,
  avgPosition: number | null = 10,
) => ({ clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, avgPosition });

describe("topicalMapGscWindows", () => {
  it("excludes the execution day and returns inclusive seven-day UTC windows", () => {
    expect(topicalMapGscWindows(new Date("2026-07-14T10:00:00Z"))).toEqual({
      before: { startDate: "2026-07-07", endDate: "2026-07-13" },
      after: { startDate: "2026-07-15", endDate: "2026-07-21" },
    });
  });
});

describe("evaluateTopicalMapGscMetrics", () => {
  it("uses clicks when they improve by more than five percent", () => {
    expect(evaluateTopicalMapGscMetrics(metrics(100, 1_000), metrics(106, 1_000))).toMatchObject({ verdict: "improved" });
  });

  it("falls back to impressions when the click baseline is zero", () => {
    expect(evaluateTopicalMapGscMetrics(metrics(0, 100), metrics(0, 90))).toMatchObject({ verdict: "worsened" });
  });

  it("treats a lower average position as improvement when traffic baselines cannot decide", () => {
    expect(evaluateTopicalMapGscMetrics(metrics(0, 0, 20), metrics(0, 0, 18))).toMatchObject({ verdict: "improved" });
  });

  it("treats changes within five percent as neutral", () => {
    expect(evaluateTopicalMapGscMetrics(metrics(100, 1_000), metrics(105, 1_000))).toMatchObject({ verdict: "neutral" });
  });

  it.each([
    [null, metrics(1, 10), "before_window_empty"],
    [metrics(1, 10), null, "after_window_empty"],
  ] as const)("returns typed insufficient data for a missing window", (before, after, reason) => {
    expect(evaluateTopicalMapGscMetrics(before, after)).toMatchObject({ verdict: "insufficient_data", reason });
  });
});
