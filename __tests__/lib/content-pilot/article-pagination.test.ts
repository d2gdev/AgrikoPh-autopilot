import { describe, expect, it, vi } from "vitest";
import { loadAllArticlePages } from "@/lib/content-pilot/article-pagination";

describe("Content Pilot article pagination", () => {
  it("loads every reported article page before returning overview rows", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      articles: Array.from({ length: page < 3 ? 50 : 20 }, (_, index) => ({ id: `${page}-${index}` })),
      total: 120,
      page,
      pages: 3,
    }));

    const result = await loadAllArticlePages(fetchPage);

    expect(fetchPage.mock.calls).toEqual([[1], [2], [3]]);
    expect(result.total).toBe(120);
    expect(result.articles).toHaveLength(120);
  });
});
