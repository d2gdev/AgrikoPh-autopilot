import { describe, expect, it } from "vitest";
import { aggregateOnPageHealth } from "@/lib/seo/health";

describe("aggregateOnPageHealth", () => {
  it("reports missing H1 when H2/H3 headings exist", () => {
    const result = aggregateOnPageHealth([{
      handle: "structured-without-h1",
      title: "Structured without H1",
      wordCount: 800,
      internalLinkCount: 2,
      headingCount: 4,
      inboundCount: 1,
      seoData: { h1Count: 0, issues: ["missing-h1"] },
    }]);
    expect(result.totals.missingH1).toBe(1);
    expect(result.worstOffenders[0]?.issues).toContain("Missing H1");
  });

  it("does not report missing H1 when h1Count is positive", () => {
    const result = aggregateOnPageHealth([{
      handle: "has-h1",
      title: "Has H1",
      wordCount: 800,
      internalLinkCount: 2,
      headingCount: 1,
      inboundCount: 1,
      seoData: { h1Count: 1, issues: [] },
    }]);
    expect(result.totals.missingH1).toBe(0);
  });
});
