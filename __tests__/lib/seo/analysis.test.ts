import { describe, expect, it } from "vitest";
import { buildProgrammaticSeoGaps } from "@/lib/seo/analysis";

describe("buildProgrammaticSeoGaps", () => {
  it("keeps thin-content and missing-meta findings for the same article", () => {
    const gaps = buildProgrammaticSeoGaps({
      queries: [],
      queryPagePairs: [],
      articles: [{
        handle: "thin-and-meta",
        title: "Thin and Meta",
        wordCount: 120,
        internalLinkCount: 0,
        seoData: { issues: ["missing-meta-description"] },
      }],
    });
    expect(gaps.map((gap) => gap.issue)).toEqual(["thin-content", "missing-meta"]);
  });

  it("does not suppress a meta finding because another title shares its prefix", () => {
    const gaps = buildProgrammaticSeoGaps({
      queries: [{ query: "black rice benefits", clicks: 0, impressions: 100, ctr: "0%", position: "8" }],
      queryPagePairs: [],
      articles: [{
        handle: "black-rice",
        title: "Black Rice",
        wordCount: 700,
        internalLinkCount: 2,
        seoData: { titleLength: 0 },
      }],
    });
    expect(gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ articleHandle: "black-rice", issue: "missing-meta" }),
    ]));
  });

  it("selects high-impression eligible gaps before applying the query limit", () => {
    const clickSortedIneligible = Array.from({ length: 30 }, (_, index) => ({
      query: `ranking query ${index}`,
      clicks: 1,
      impressions: 10,
      ctr: "10%",
      position: "1",
    }));

    const gaps = buildProgrammaticSeoGaps({
      queries: [
        ...clickSortedIneligible,
        {
          query: "organic black rice philippines",
          clicks: 0,
          impressions: 10_000,
          ctr: "0%",
          position: "8",
        },
      ],
      queryPagePairs: [],
      articles: [],
    });

    expect(gaps).toEqual([
      expect.objectContaining({
        query: "organic black rice philippines",
        impressions: 10_000,
        position: 8,
      }),
    ]);
  });
});
