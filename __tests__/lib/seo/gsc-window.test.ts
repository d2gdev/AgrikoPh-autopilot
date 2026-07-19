import { describe, expect, it } from "vitest";
import { buildGscReportingWindows } from "@/lib/seo/gsc-window";

const DAY_MS = 24 * 60 * 60 * 1000;

function inclusiveDays(window: { start: Date; end: Date }): number {
  return Math.round((window.end.getTime() - window.start.getTime()) / DAY_MS) + 1;
}

describe("buildGscReportingWindows", () => {
  it("builds adjacent inclusive 28-day UTC windows", () => {
    const result = buildGscReportingWindows({
      capturedAt: new Date("2026-07-20T14:23:00.000Z"),
      lagDays: 3,
      windowDays: 28,
    });

    expect(result.current).toEqual({
      start: new Date("2026-06-20T00:00:00.000Z"),
      end: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(result.previous).toEqual({
      start: new Date("2026-05-23T00:00:00.000Z"),
      end: new Date("2026-06-19T00:00:00.000Z"),
    });
    expect(inclusiveDays(result.current)).toBe(28);
    expect(inclusiveDays(result.previous)).toBe(28);
    expect(result.previous.end.getTime()).toBe(result.current.start.getTime() - DAY_MS);
  });

  it("normalizes non-midnight captures to UTC reporting dates", () => {
    const result = buildGscReportingWindows({
      capturedAt: new Date("2026-07-01T23:59:59.999Z"),
      lagDays: 3,
      windowDays: 28,
    });

    expect(result.current).toEqual({
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-06-28T00:00:00.000Z"),
    });
  });

  it("supports adjacent one-day windows", () => {
    const result = buildGscReportingWindows({
      capturedAt: new Date("2026-07-20T04:00:00.000Z"),
      lagDays: 0,
      windowDays: 1,
    });

    expect(result.current).toEqual({
      start: new Date("2026-07-20T00:00:00.000Z"),
      end: new Date("2026-07-20T00:00:00.000Z"),
    });
    expect(result.previous).toEqual({
      start: new Date("2026-07-19T00:00:00.000Z"),
      end: new Date("2026-07-19T00:00:00.000Z"),
    });
  });

  it("clamps negative and fractional inputs to whole reporting days", () => {
    const result = buildGscReportingWindows({
      capturedAt: new Date("2026-07-20T04:00:00.000Z"),
      lagDays: -2.4,
      windowDays: 2.9,
    });

    expect(result.current).toEqual({
      start: new Date("2026-07-19T00:00:00.000Z"),
      end: new Date("2026-07-20T00:00:00.000Z"),
    });
    expect(inclusiveDays(result.current)).toBe(2);
    expect(inclusiveDays(result.previous)).toBe(2);
  });
});
