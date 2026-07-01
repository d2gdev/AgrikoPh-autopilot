import { describe, expect, it } from "vitest";

import { priorityRank } from "@/lib/growth-brief/priority";

describe("growth-brief priorityRank", () => {
  it("orders P0..P3 ascending", () => {
    expect(priorityRank("P0")).toBeLessThan(priorityRank("P1"));
    expect(priorityRank("P1")).toBeLessThan(priorityRank("P2"));
    expect(priorityRank("P2")).toBeLessThan(priorityRank("P3"));
  });

  it("normalizes word grades into the same scale (High < Medium < Low)", () => {
    expect(priorityRank("High")).toBeLessThan(priorityRank("Medium"));
    expect(priorityRank("Medium")).toBeLessThan(priorityRank("Low"));
  });

  it("does NOT float a word-grade 'Medium' above a real P1 (the reported bug)", () => {
    // A raw string sort put 'Medium' (M) before 'P1' (P); rank must not.
    expect(priorityRank("P1")).toBeLessThan(priorityRank("Medium"));
    expect(priorityRank("Medium")).toBe(priorityRank("P2"));
  });

  it("gives equal priorities an equal rank (stable comparator, returns 0 diff)", () => {
    expect(priorityRank("P2") - priorityRank("P2")).toBe(0);
  });

  it("sends unknown/empty priorities to the bottom", () => {
    expect(priorityRank(null)).toBeGreaterThan(priorityRank("P3"));
    expect(priorityRank("")).toBeGreaterThan(priorityRank("Low"));
  });
});
