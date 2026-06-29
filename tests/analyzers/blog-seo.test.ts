import { describe, it, expect } from "vitest";
import { analyzeSeo } from "@/lib/analyzers/blog-seo";
import type { ParsedArticleHtml } from "@/lib/analyzers/html-parser";

const baseParsed: ParsedArticleHtml = {
  h1s: ["How to Grow Moringa at Home"],
  h2s: ["Why Moringa", "Planting Tips"],
  h3s: [],
  anchors: [],
  images: [],
  textContent: "Moringa is a superfood. ".repeat(100),
  wordCount: 400,
};

describe("analyzeSeo", () => {
  it("returns correct title length for seoTitle", () => {
    const result = analyzeSeo({ seoTitle: "Moringa Guide", seoDescription: "A guide." }, baseParsed);
    expect(result.titleLength).toBe(13);
    expect(result.descLength).toBe(8);
  });

  it("flags missing meta description", () => {
    const result = analyzeSeo({ seoTitle: "Moringa", seoDescription: null }, baseParsed);
    expect(result.issues).toContain("missing-meta-description");
  });

  it("flags title too long (>60 chars)", () => {
    const longTitle = "A".repeat(61);
    const result = analyzeSeo({ seoTitle: longTitle, seoDescription: "desc" }, baseParsed);
    expect(result.issues).toContain("title-too-long");
  });

  it("flags meta description too long (>160 chars)", () => {
    const longDesc = "A".repeat(161);
    const result = analyzeSeo({ seoTitle: "Title", seoDescription: longDesc }, baseParsed);
    expect(result.issues).toContain("meta-description-too-long");
  });

  it("flags multiple H1s", () => {
    const parsed = { ...baseParsed, h1s: ["H1 one", "H1 two"] };
    const result = analyzeSeo({ seoTitle: "Title", seoDescription: "desc" }, parsed);
    expect(result.issues).toContain("multiple-h1");
  });

  it("flags missing H1", () => {
    const parsed = { ...baseParsed, h1s: [] };
    const result = analyzeSeo({ seoTitle: "Title", seoDescription: "desc" }, parsed);
    expect(result.issues).toContain("missing-h1");
  });

  it("flags thin content (<300 words)", () => {
    const parsed = { ...baseParsed, wordCount: 150 };
    const result = analyzeSeo({ seoTitle: "Title", seoDescription: "desc" }, parsed);
    expect(result.issues).toContain("thin-content");
  });

  it("computes reading time (ceil words/200)", () => {
    const parsed = { ...baseParsed, wordCount: 350 };
    const result = analyzeSeo({ seoTitle: "Title", seoDescription: "desc" }, parsed);
    expect(result.readingTime).toBe(2);
  });

  it("scores 100 for a clean article", () => {
    const result = analyzeSeo({ seoTitle: "Moringa Guide", seoDescription: "A concise guide." }, baseParsed);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it("deducts points for each issue", () => {
    const result = analyzeSeo({ seoTitle: "A".repeat(61), seoDescription: null }, { ...baseParsed, h1s: [] });
    expect(result.score).toBeLessThan(100);
  });
});
