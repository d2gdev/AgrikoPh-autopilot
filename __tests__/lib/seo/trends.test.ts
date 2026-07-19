import { describe, expect, it } from "vitest";
import { computeTrends } from "@/lib/seo/trends";

describe("computeTrends movers", () => {
  it("includes vanished queries as fallers and never duplicates movers", () => {
    const result = computeTrends(
      [{ query: "current only", clicks: 1, impressions: 10, ctr: "10%", position: "5" }],
      [{ query: "lost query", clicks: 10, impressions: 100, ctr: "10%", position: "2" }],
      null,
      null,
    );

    expect(result.movers).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: "current only", clicksDelta: 1 }),
      expect.objectContaining({ query: "lost query", clicks: 0, clicksDelta: -10, impressionsDelta: -100, direction: "down" }),
    ]));
    expect(new Set(result.movers.map((mover) => mover.query)).size).toBe(result.movers.length);
  });

  it("uses property aggregates for cards while retaining query rows for movers", () => {
    const result = computeTrends(
      [{ query: "visible query", clicks: 51, impressions: 13402, ctr: "0.4%", position: "11.2" }],
      [{ query: "visible query", clicks: 12, impressions: 1000, ctr: "1.2%", position: "14.0" }],
      "2026-07-20T04:00:00.000Z",
      "2026-06-20T04:00:00.000Z",
      { clicks: 201, impressions: 32488, avgCtr: 0.0061875, avgPosition: 13.42 },
      { clicks: 55, impressions: 4618, avgCtr: 0.0119, avgPosition: 18.4 },
    );

    expect(result.current).toEqual({
      clicks: 201,
      impressions: 32488,
      avgCtr: 0.0061875,
      avgPosition: 13.42,
    });
    expect(result.previous?.clicks).toBe(55);
    expect(result.movers).toContainEqual(expect.objectContaining({
      query: "visible query",
      clicksDelta: 39,
    }));
  });

  it("keeps property cards unavailable instead of summing dimensioned rows", () => {
    const result = computeTrends(
      [{ query: "visible query", clicks: 51, impressions: 13402, ctr: "0.4%", position: "11.2" }],
      null,
      null,
      null,
      null,
      null,
    );

    expect(result.current).toBeNull();
    expect(result.previous).toBeNull();
  });
});
