import { describe, it, expect } from "vitest";
import { smoothedMedian, gapIsStable, type PricePoint } from "../price-signal";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ASOF = new Date("2026-07-01T00:00:00Z");

/** Build a PricePoint `daysAgo` days before ASOF. */
function pointDaysAgo(daysAgo: number, price: number): PricePoint {
  return { price, capturedAt: new Date(ASOF.getTime() - daysAgo * MS_PER_DAY) };
}

describe("smoothedMedian", () => {
  it("returns null for an empty series", () => {
    expect(smoothedMedian([], { windowDays: 7, outlierPct: 40, asOf: ASOF })).toBeNull();
  });

  it("returns null for a single-point series (refuses to act on one capture)", () => {
    const series = [pointDaysAgo(0, 200)];
    expect(smoothedMedian(series, { windowDays: 7, outlierPct: 40, asOf: ASOF })).toBeNull();
  });

  it("rejects a single-day spike as an outlier and leaves the median unmoved", () => {
    // 7 days of ~200 with one spike to 600 three days ago.
    const series = [
      pointDaysAgo(6, 199),
      pointDaysAgo(5, 201),
      pointDaysAgo(4, 198),
      pointDaysAgo(3, 600), // spike
      pointDaysAgo(2, 202),
      pointDaysAgo(1, 199),
      pointDaysAgo(0, 201),
    ];
    const result = smoothedMedian(series, { windowDays: 7, outlierPct: 40, asOf: ASOF });
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThanOrEqual(198);
    expect(result).toBeLessThanOrEqual(202);
  });

  it("returns the exact boundary value when all survivors agree", () => {
    const series = [
      pointDaysAgo(2, 225),
      pointDaysAgo(1, 225),
      pointDaysAgo(0, 225),
    ];
    expect(smoothedMedian(series, { windowDays: 3, outlierPct: 40, asOf: ASOF })).toBe(225);
  });
});

describe("gapIsStable", () => {
  it("reports a clean 14-day gap (competitor ~200 vs own 300) as stable", () => {
    const competitorPrices = [198, 202, 199, 201, 197, 203, 200, 198, 202, 199, 201, 200, 199, 201];
    const series: PricePoint[] = competitorPrices.map((price, idx) =>
      pointDaysAgo(13 - idx, price),
    );

    const result = gapIsStable({
      ownPrice: 300,
      series,
      gapPct: 20,
      minDays: 14,
      windowDays: 3,
      outlierPct: 40,
      asOf: ASOF,
    });

    expect(result.stable).toBe(true);
    expect(result.smoothed).not.toBeNull();
    expect(result.gapPctNow).not.toBeNull();
    expect(result.gapPctNow!).toBeGreaterThan(20);
    expect(result.daysStable).toBeGreaterThanOrEqual(12);
  });

  it("reports empty/single-point series as not stable", () => {
    const emptyResult = gapIsStable({
      ownPrice: 300,
      series: [],
      gapPct: 20,
      minDays: 14,
      windowDays: 3,
      outlierPct: 40,
      asOf: ASOF,
    });
    expect(emptyResult.stable).toBe(false);
    expect(emptyResult.smoothed).toBeNull();
    expect(emptyResult.gapPctNow).toBeNull();

    const singlePointResult = gapIsStable({
      ownPrice: 300,
      series: [pointDaysAgo(0, 200)],
      gapPct: 20,
      minDays: 14,
      windowDays: 3,
      outlierPct: 40,
      asOf: ASOF,
    });
    expect(singlePointResult.stable).toBe(false);
    expect(singlePointResult.smoothed).toBeNull();
  });

  it("reports stable: false with daysStable ~5 when the gap only appeared 5 days ago", () => {
    // Days 13..6 ago (8 points): prices close to own price (~295, no real gap).
    // Days 5..0 ago (6 points): prices drop to ~200 (a real gap vs own 300).
    const series: PricePoint[] = [];
    for (let daysAgo = 13; daysAgo >= 6; daysAgo--) {
      series.push(pointDaysAgo(daysAgo, 295));
    }
    for (let daysAgo = 5; daysAgo >= 0; daysAgo--) {
      series.push(pointDaysAgo(daysAgo, 200));
    }

    const result = gapIsStable({
      ownPrice: 300,
      series,
      gapPct: 20,
      minDays: 14,
      windowDays: 1,
      outlierPct: 40,
      asOf: ASOF,
    });

    expect(result.stable).toBe(false);
    expect(result.daysStable).toBe(5);
  });

  it("does NOT treat a gap of exactly gapPct% as a gap (strict > required)", () => {
    // own=300, smoothed=225 => ((300-225)/300)*100 === 25 exactly.
    const series: PricePoint[] = [];
    for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
      series.push(pointDaysAgo(daysAgo, 225));
    }

    const result = gapIsStable({
      ownPrice: 300,
      series,
      gapPct: 25,
      minDays: 5,
      windowDays: 3,
      outlierPct: 40,
      asOf: ASOF,
    });

    expect(result.gapPctNow).toBe(25);
    expect(result.stable).toBe(false);
    expect(result.daysStable).toBe(0);
  });
});
