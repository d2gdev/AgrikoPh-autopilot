import { describe, expect, it } from "vitest";
import {
  normalizeArticleSystemTags,
  resolveArticleSystemAssignment,
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
