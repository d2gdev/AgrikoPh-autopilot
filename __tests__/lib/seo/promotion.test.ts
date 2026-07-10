import { describe, expect, it } from "vitest";
import { articleHandleFromBlogPage, classifySeoPromotion } from "@/lib/seo/promotion";

describe("classifySeoPromotion", () => {
  const article = { handle: "black-rice-benefits" };

  it.each(["low_ctr", "high_impression_no_click"])(
    "maps existing-page %s work to seo-fix",
    (opportunityType) => {
      expect(classifySeoPromotion({
        opportunityType,
        page: "https://agrikoph.com/blogs/news/black-rice-benefits",
        requestedHandle: "black-rice-benefits",
        matchedArticle: article,
      })).toEqual({ kind: "proposal", proposalType: "seo-fix" });
    },
  );

  it("maps an existing-page striking-distance opportunity to content-refresh", () => {
    expect(classifySeoPromotion({
      opportunityType: "striking_distance",
      page: "https://agrikoph.com/blogs/news/black-rice-benefits",
      requestedHandle: "black-rice-benefits",
      matchedArticle: article,
    })).toEqual({ kind: "proposal", proposalType: "content-refresh" });
  });

  it("maps an uncovered query to new-content", () => {
    expect(classifySeoPromotion({ matchedArticle: null })).toEqual({
      kind: "proposal",
      proposalType: "new-content",
    });
  });

  it("skips an existing non-blog landing page", () => {
    expect(classifySeoPromotion({
      opportunityType: "low_ctr",
      page: "https://agrikoph.com/products/black-rice",
      matchedArticle: null,
    })).toEqual({ kind: "skip", reason: "nonBlogExistingPage" });
  });

  it("does not trust an unresolved blog handle", () => {
    expect(classifySeoPromotion({
      opportunityType: "low_ctr",
      page: "https://agrikoph.com/blogs/news/missing",
      requestedHandle: "missing",
      matchedArticle: null,
    })).toEqual({ kind: "skip", reason: "missingArticle" });
  });
});

describe("articleHandleFromBlogPage", () => {
  it("extracts and normalizes Shopify article handles", () => {
    expect(articleHandleFromBlogPage("https://agrikoph.com/blogs/news/Black-Rice?x=1"))
      .toBe("black-rice");
  });
});
