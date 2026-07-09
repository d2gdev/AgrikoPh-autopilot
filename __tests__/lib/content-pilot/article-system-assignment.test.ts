import { describe, expect, it } from "vitest";
import {
  normalizeArticleSystemTags,
  resolveArticleSystemAssignment,
  resolveArticleTemplateSuffix,
} from "@/lib/content-pilot/article-system-assignment";

describe("resolveArticleSystemAssignment", () => {
  it("keeps mixed-topic distributor articles general when the title has no single category", () => {
    expect(
      resolveArticleSystemAssignment({
        title: "How to Choose an Organic Health Products Distributor Philippines Families Trust",
        tags: ["organic rice philippines", "red rice philippines", "turmeric tea philippines"],
        blogHandle: "news",
      }),
    ).toEqual({ template: "buying-guide", profile: "general" });
  });

  it("derives canonical rice tags when a black rice draft has no useful tags", () => {
    expect(
      normalizeArticleSystemTags({
        title: "How to Choose the Best Black Rice Brands in the Philippines",
        tags: [],
        blogHandle: "news",
      }),
    ).toEqual([
      "organic rice",
      "organic rice philippines",
      "black rice",
      "rice-type:black-rice",
      "organic black rice philippines",
      "buying guide",
    ]);
  });

  it("derives herbal tags from body content when the title and draft tags are generic", () => {
    expect(
      normalizeArticleSystemTags({
        title: "A Practical Wellness Guide",
        bodyHtml: "<h2>Sambong herb Philippines</h2><p>A guide to Filipino herbal wellness.</p>",
        tags: [" Wellness "],
        blogHandle: "news",
      }),
    ).toEqual(["filipino herbal wellness", "sambong"]);
  });

  it("maps sustainable rice farming titles to farming-trust instead of rice guide", () => {
    expect(
      resolveArticleSystemAssignment({
        title: "Sustainable Rice Farming in the Philippines",
        tags: ["organic rice"],
        blogHandle: "news",
      }),
    ).toEqual({ template: "farming-trust", profile: "farming" });
  });

  it("uses target keyword as fallback evidence for generic titles", () => {
    expect(
      resolveArticleSystemAssignment({
        title: "A Practical Guide for Filipino Families",
        targetKeyword: "organic black rice philippines",
        tags: [],
        blogHandle: "news",
      }),
    ).toEqual({ template: "guide", profile: "rice" });
  });

  it("uses turmeric keyword fallback for generic titles without downgrading to general", () => {
    expect(
      resolveArticleSystemAssignment({
        title: "A Practical Guide",
        targetKeyword: "turmeric tea philippines",
        tags: [],
        blogHandle: "news",
      }),
    ).toEqual({ template: "guide", profile: "turmeric" });
  });

  it("normalizes generic turmeric tea drafts to turmeric tags", () => {
    expect(
      normalizeArticleSystemTags({
        title: "A Practical Guide",
        targetKeyword: "turmeric tea philippines",
        tags: ["turmeric tea philippines"],
        blogHandle: "news",
      }),
    ).toEqual(["turmeric tea philippines", "turmeric"]);
  });

  it("prefers target keyword over body content for generic titles", () => {
    expect(
      resolveArticleSystemAssignment({
        title: "A Practical Guide for Filipino Families",
        targetKeyword: "organic black rice philippines",
        bodyHtml: "<p>This draft currently discusses turmeric tea benefits.</p>",
        tags: [],
        blogHandle: "news",
      }),
    ).toEqual({ template: "guide", profile: "rice" });
  });

  it("drops neutral tags for non-general profiles while keeping matching category tags", () => {
    expect(
      normalizeArticleSystemTags({
        title: "Turmeric Tea Philippines: Benefits, How to Brew, and Best Options",
        tags: ["wellness", "organic rice philippines", "best black rice brands philippines", "turmeric tea philippines"],
        blogHandle: "news",
      }),
    ).toEqual(["turmeric tea philippines", "turmeric"]);
  });

  it("preserves neutral tags for general articles while removing category noise", () => {
    expect(
      normalizeArticleSystemTags({
        title: "How to Choose an Organic Health Products Distributor Philippines Families Trust",
        tags: ["supplier", "organic rice philippines", "turmeric tea philippines"],
        blogHandle: "news",
      }),
    ).toEqual(["supplier", "organic health products", "buying guide"]);
  });

  it("prunes conflicting rice tags from turmeric articles", () => {
    expect(
      normalizeArticleSystemTags({
        title: "Turmeric Tea Philippines: Benefits, How to Brew, and Best Options",
        tags: ["organic rice philippines", "best black rice brands philippines", "turmeric tea philippines"],
        blogHandle: "news",
      }),
    ).toEqual(["turmeric tea philippines", "turmeric"]);
  });
});

describe("resolveArticleTemplateSuffix", () => {
  it("maps specific handles to explicit template suffixes", () => {
    expect(
      resolveArticleTemplateSuffix({
        title: "Turmeric Tea Philippines — Benefits, How to Brew, and Best Options",
        articleHandle: "turmeric-tea-philippines-benefits-how-to-brew-and-best-options",
        tags: [],
        blogHandle: "news",
      }),
    ).toBe("turmeric-tea-benefits-philippines");
  });

  it("uses target content for buying-focused rice pages", () => {
    expect(
      resolveArticleTemplateSuffix({
        title: "How to Choose the Best Black Rice Brands in the Philippines",
        tags: ["rice"],
        blogHandle: "news",
      }),
    ).toBe("where-to-buy-organic-rice");
  });

  it("defaults to null for unknown article themes", () => {
    expect(
      resolveArticleTemplateSuffix({
        title: "A general guide to wellness and health",
        tags: ["nutrition", "wellbeing"],
        blogHandle: "news",
      }),
    ).toBeNull();
  });
});
