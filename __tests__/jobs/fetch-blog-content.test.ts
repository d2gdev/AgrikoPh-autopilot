import { describe, it, expect } from "vitest";
import { computeContentHash, computeInboundCounts } from "@/jobs/fetch-blog-content";
import type { LinksAnalysis } from "@/lib/analyzers/blog-links";

// Helper to build a minimal LinksAnalysis fixture
function linksAnalysis(internalHrefs: string[]): LinksAnalysis {
  return {
    internal: internalHrefs.map((href) => ({ href, text: "" })),
    external: [],
    cta: [],
  };
}

describe("computeContentHash", () => {
  it("is deterministic — same content returns same hash on two calls", () => {
    const html = "<p>Hello world</p>";
    const hash1 = computeContentHash(html);
    const hash2 = computeContentHash(html);
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different content", () => {
    const hash1 = computeContentHash("<p>Content A</p>");
    const hash2 = computeContentHash("<p>Content B</p>");
    expect(hash1).not.toBe(hash2);
  });

  it("handles empty string without throwing", () => {
    expect(() => computeContentHash("")).not.toThrow();
    const hash = computeContentHash("");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("returns a hex string of consistent length (SHA-256 = 64 chars)", () => {
    const hash = computeContentHash("<h1>Organic Rice Benefits</h1>");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeInboundCounts", () => {
  it("counts a valid blog URL link", () => {
    const linksMap = {
      "source-article": linksAnalysis(["https://agrikoph.com/blogs/news/my-article"]),
    };
    const counts = computeInboundCounts(linksMap);
    expect(counts["my-article"]).toBe(1);
  });

  it("does not count non-blog URLs (product pages)", () => {
    const linksMap = {
      "source-article": linksAnalysis(["https://agrikoph.com/products/organic-rice"]),
    };
    const counts = computeInboundCounts(linksMap);
    expect(Object.keys(counts)).toHaveLength(0);
  });

  it("does not count non-blog URLs (collection pages)", () => {
    const linksMap = {
      "source-article": linksAnalysis(["https://agrikoph.com/collections/rice"]),
    };
    const counts = computeInboundCounts(linksMap);
    expect(Object.keys(counts)).toHaveLength(0);
  });

  it("does not throw on malformed URLs — returns 0 counts", () => {
    const linksMap = {
      "source-article": linksAnalysis(["not-a-url"]),
    };
    expect(() => computeInboundCounts(linksMap)).not.toThrow();
    const counts = computeInboundCounts(linksMap);
    expect(Object.keys(counts)).toHaveLength(0);
  });

  it("accumulates counts when multiple articles link to the same target", () => {
    const linksMap = {
      "article-a": linksAnalysis(["https://agrikoph.com/blogs/news/target-article"]),
      "article-b": linksAnalysis(["https://agrikoph.com/blogs/news/target-article"]),
      "article-c": linksAnalysis(["https://agrikoph.com/blogs/news/target-article"]),
    };
    const counts = computeInboundCounts(linksMap);
    expect(counts["target-article"]).toBe(3);
  });

  it("handles mixed valid and invalid links correctly", () => {
    const linksMap = {
      "source-article": {
        internal: [
          { href: "https://agrikoph.com/blogs/news/valid-post", text: "Valid" },
          { href: "https://agrikoph.com/products/rice", text: "Product" },
          { href: "not-a-url", text: "Bad" },
        ],
        external: [],
        cta: [],
      } satisfies LinksAnalysis,
    };
    const counts = computeInboundCounts(linksMap);
    expect(counts["valid-post"]).toBe(1);
    expect(Object.keys(counts)).toHaveLength(1);
  });

  it("handles empty linksMap without throwing", () => {
    expect(() => computeInboundCounts({})).not.toThrow();
    const counts = computeInboundCounts({});
    expect(Object.keys(counts)).toHaveLength(0);
  });
});
