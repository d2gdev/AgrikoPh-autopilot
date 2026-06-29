import { describe, expect, it } from "vitest";
import {
  articleHandleFromPath,
  buildArticleSessionMap,
  toPageAnalyticsInput,
} from "@/lib/seo/page-analytics";

describe("toPageAnalyticsInput", () => {
  it("normalizes GA4 page rows into numeric page analytics input", () => {
    const result = toPageAnalyticsInput({
      page: "https://agrikoph.com/blogs/news/Organic-Rice?utm_source=test",
      sessions: 12.2,
      totalUsers: "10",
      conversions: "2",
      bounceRate: "45.5%",
      conversionRate: "16.67%",
    });

    expect(result).toMatchObject({
      page: "/blogs/news/organic-rice",
      sessions: 12,
      totalUsers: 10,
      conversions: 2,
      bounceRate: 0.455,
    });
    expect(result?.conversionRate).toBeCloseTo(0.1667);
  });

  it("returns null for blank pages", () => {
    expect(toPageAnalyticsInput({
      page: "",
      sessions: 0,
      bounceRate: "0%",
      conversionRate: "0%",
    })).toBeNull();
  });
});

describe("articleHandleFromPath", () => {
  it("extracts blog article handles from normalized paths", () => {
    expect(articleHandleFromPath("/blogs/news/black-rice-philippines")).toBe("black-rice-philippines");
    expect(articleHandleFromPath("https://agrikoph.com/blogs/recipes/red-rice-sinangag")).toBe("red-rice-sinangag");
  });

  it("ignores non-blog paths", () => {
    expect(articleHandleFromPath("/products/organic-rice")).toBe("");
  });
});

describe("buildArticleSessionMap", () => {
  it("sums sessions by article handle", () => {
    const result = buildArticleSessionMap([
      { page: "/blogs/news/organic-rice", sessions: 10 },
      { page: "https://agrikoph.com/blogs/news/organic-rice?x=1", sessions: 5 },
      { page: "/products/organic-rice", sessions: 100 },
    ]);

    expect(result).toEqual({ "organic-rice": 15 });
  });
});
