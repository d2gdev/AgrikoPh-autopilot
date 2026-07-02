import { describe, expect, it } from "vitest";
import { evaluateConversion } from "@/lib/ad-approval/scoring";

describe("evaluateConversion", () => {
  it("passes at exactly 24 total with no question below 3", () => {
    const r = evaluateConversion([4, 4, 4, 4, 4, 4]); // 24
    expect(r).toEqual({ total: 24, lowest: 4, passed: true });
  });

  it("fails when total is below 24", () => {
    const r = evaluateConversion([4, 4, 4, 4, 4, 3]); // 23
    expect(r.total).toBe(23);
    expect(r.passed).toBe(false);
  });

  it("fails the per-question floor even when total is high", () => {
    const r = evaluateConversion([5, 5, 5, 5, 5, 2]); // 27 but a 2
    expect(r.total).toBe(27);
    expect(r.lowest).toBe(2);
    expect(r.passed).toBe(false);
  });

  it("passes a strong scorecard", () => {
    expect(evaluateConversion([5, 5, 4, 4, 5, 4]).passed).toBe(true);
  });
});
