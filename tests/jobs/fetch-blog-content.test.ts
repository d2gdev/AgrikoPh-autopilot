import { describe, it, expect } from "vitest";
import { computeContentHash, computeInboundCounts } from "@/jobs/fetch-blog-content";
import type { LinksAnalysis } from "@/lib/analyzers/blog-links";

describe("computeContentHash", () => {
  it("returns a 64-char hex string for any input", () => {
    const hash = computeContentHash("<p>hello</p>");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it("returns identical hashes for identical input", () => {
    expect(computeContentHash("same")).toBe(computeContentHash("same"));
  });

  it("returns different hashes for different input", () => {
    expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
  });
});

describe("computeInboundCounts", () => {
  it("counts how many articles link to each handle", () => {
    const linksMap: Record<string, LinksAnalysis> = {
      "article-a": {
        internal: [
          { href: "/blogs/news/article-b", text: "article b" },
          { href: "https://agrikoph.com/blogs/news/article-c", text: "article c" },
        ],
        external: [],
        cta: [],
      },
      "article-b": {
        internal: [{ href: "/blogs/news/article-c", text: "article c" }],
        external: [],
        cta: [],
      },
      "article-c": { internal: [], external: [], cta: [] },
    };

    const counts = computeInboundCounts(linksMap);
    expect(counts["article-b"]).toBe(1);
    expect(counts["article-c"]).toBe(2);
    expect(counts["article-a"] ?? 0).toBe(0);
  });

  it("returns zero counts when no internal links exist", () => {
    const linksMap: Record<string, LinksAnalysis> = {
      "article-a": { internal: [], external: [], cta: [] },
    };
    const counts = computeInboundCounts(linksMap);
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });
});
