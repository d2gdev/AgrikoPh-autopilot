import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeAgo, formatPhp, formatMoney, fmtNum, actionLabel } from "@/lib/format";

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("handles null and garbage", () => {
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo(undefined)).toBe("never");
    expect(timeAgo("not-a-date")).toBe("unknown");
  });

  it("formats past times", () => {
    expect(timeAgo("2026-07-03T11:59:40.000Z")).toBe("just now");
    expect(timeAgo("2026-07-03T11:55:00.000Z")).toBe("5m ago");
    expect(timeAgo("2026-07-03T09:00:00.000Z")).toBe("3h ago");
    expect(timeAgo("2026-07-01T12:00:00.000Z")).toBe("2d ago");
  });

  it("formats future times", () => {
    expect(timeAgo("2026-07-03T12:10:00.000Z")).toBe("10m from now");
  });

  it("falls back to a short date past 30 days", () => {
    expect(timeAgo("2026-05-01T12:00:00.000Z")).toMatch(/May 1/);
  });
});

describe("formatPhp", () => {
  it("formats with peso sign and decimals", () => {
    expect(formatPhp(1234.5)).toBe("₱1,234.50");
    expect(formatPhp(1234.5, 0)).toBe("₱1,235");
  });
});

describe("formatMoney", () => {
  it("uses data currency when provided, peso otherwise", () => {
    expect(formatMoney(120, "USD")).toBe("USD 120.00");
    expect(formatMoney(120)).toBe("₱120.00");
    expect(formatMoney(120.5, "PHP")).toBe("PHP 120.50");
  });
});

describe("fmtNum", () => {
  it("abbreviates large numbers", () => {
    expect(fmtNum(1_500_000)).toBe("1.5M");
    expect(fmtNum(12_345)).toBe("12.3K");
    expect(fmtNum(999)).toBe("999");
  });
});

describe("actionLabel", () => {
  it("maps known actions and title-cases unknowns", () => {
    expect(actionLabel("pause_ad")).toBe("Pause Ad");
    expect(actionLabel("adjust_budget")).toBe("Adjust Budget");
    expect(actionLabel("some_new_thing")).toBe("Some New Thing");
  });
});
