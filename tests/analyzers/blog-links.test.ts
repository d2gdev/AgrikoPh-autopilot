import { describe, it, expect } from "vitest";
import { analyzeLinks } from "@/lib/analyzers/blog-links";
import type { ParsedArticleHtml } from "@/lib/analyzers/html-parser";

const parsed: ParsedArticleHtml = {
  h1s: [],
  h2s: [],
  h3s: [],
  anchors: [
    { href: "/blogs/news/moringa-benefits", text: "moringa benefits" },
    { href: "https://agrikoph.com/products/moringa", text: "Shop Moringa" },
    { href: "https://external.com/research", text: "external research" },
    { href: "/blogs/news/rice-guide", text: "Read more" },
    { href: "https://agrikoph.com/blogs/news/ginger", text: "shop now" },
  ],
  images: [],
  textContent: "",
  wordCount: 0,
};

describe("analyzeLinks", () => {
  it("classifies internal links (relative or agrikoph.com)", () => {
    const result = analyzeLinks(parsed);
    expect(result.internal).toHaveLength(4);
    expect(result.internal.map((l) => l.href)).toContain("/blogs/news/moringa-benefits");
    expect(result.internal.map((l) => l.href)).toContain("https://agrikoph.com/products/moringa");
  });

  it("classifies external links (non-agrikoph.com absolute URLs)", () => {
    const result = analyzeLinks(parsed);
    expect(result.external).toHaveLength(1);
    expect(result.external[0]?.href).toBe("https://external.com/research");
  });

  it("detects CTA links by anchor text pattern", () => {
    const result = analyzeLinks(parsed);
    const ctaTexts = result.cta.map((l) => l.text.toLowerCase());
    expect(ctaTexts).toContain("shop now");
    expect(ctaTexts).not.toContain("read more");
  });

  it("returns empty arrays for no anchors", () => {
    const empty: ParsedArticleHtml = { h1s: [], h2s: [], h3s: [], anchors: [], images: [], textContent: "", wordCount: 0 };
    const result = analyzeLinks(empty);
    expect(result.internal).toHaveLength(0);
    expect(result.external).toHaveLength(0);
    expect(result.cta).toHaveLength(0);
  });
});
