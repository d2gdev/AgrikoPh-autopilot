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
});
