import { describe, it, expect } from "vitest";
import { parseArticleHtml } from "@/lib/analyzers/html-parser";

const SAMPLE_HTML = `
<h1>Growing Moringa</h1>
<h2>Why Moringa</h2>
<h2>How to Grow</h2>
<p>Moringa is a superfood with incredible nutrition.</p>
<a href="/blogs/news/moringa-benefits">Read more about moringa</a>
<a href="https://external.com/resource">External resource</a>
<img src="/images/moringa.jpg" alt="moringa plant" />
<p>Buy now to experience the benefits.</p>
`;

describe("parseArticleHtml", () => {
  it("extracts h1s, h2s, h3s", () => {
    const result = parseArticleHtml(SAMPLE_HTML);
    expect(result.h1s).toEqual(["Growing Moringa"]);
    expect(result.h2s).toEqual(["Why Moringa", "How to Grow"]);
    expect(result.h3s).toEqual([]);
  });

  it("extracts anchor hrefs and text", () => {
    const result = parseArticleHtml(SAMPLE_HTML);
    expect(result.anchors).toHaveLength(2);
    expect(result.anchors[0]).toEqual({
      href: "/blogs/news/moringa-benefits",
      text: "Read more about moringa",
    });
    expect(result.anchors[1]).toEqual({
      href: "https://external.com/resource",
      text: "External resource",
    });
  });

  it("extracts image srcs", () => {
    const result = parseArticleHtml(SAMPLE_HTML);
    expect(result.images).toContain("/images/moringa.jpg");
  });

  it("counts words in textContent", () => {
    const result = parseArticleHtml(SAMPLE_HTML);
    expect(result.wordCount).toBeGreaterThan(5);
  });

  it("returns empty arrays for empty html", () => {
    const result = parseArticleHtml("");
    expect(result.h1s).toEqual([]);
    expect(result.anchors).toEqual([]);
    expect(result.wordCount).toBe(0);
  });
});
