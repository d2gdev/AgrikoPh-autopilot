import { beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import { collectSourceDocs } from "@/lib/ai/knowledge-sources";
import { prisma } from "@/lib/db";
import { fetchBlogArticles } from "@/lib/shopify-admin";

vi.mock("@/lib/shopify-admin", () => ({ fetchBlogArticles: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    productReview: { findMany: vi.fn() },
    contentProposal: { findMany: vi.fn() },
    marketInsight: { findMany: vi.fn() },
    recommendation: { findMany: vi.fn() },
    competitorAd: { findMany: vi.fn() },
  },
}));

beforeEach(() => {
  (fetchBlogArticles as Mock).mockResolvedValue([]);
  for (const m of Object.values(prisma as unknown as Record<string, { findMany: Mock }>)) {
    m.findMany.mockResolvedValue([]);
  }
});

test("maps blog articles to SourceDoc with citation metadata", async () => {
  (fetchBlogArticles as Mock).mockResolvedValue([
    { id: "gid://shopify/Article/1", title: "Ginger 101", bodyHtml: "<p>Ginger is great</p>", handle: "ginger-101", onlineStoreUrl: "https://agrikoph.com/blogs/news/ginger-101" },
  ]);
  const docs = await collectSourceDocs();
  const art = docs.find((d) => d.sourceType === "article");
  expect(art).toMatchObject({ sourceType: "article", sourceId: "gid://shopify/Article/1" });
  expect(art!.text).toContain("Ginger");
  expect(art!.metadata).toMatchObject({ title: "Ginger 101", url: "https://agrikoph.com/blogs/news/ginger-101" });
});

test("uses ProductReview.text and skips empty-text rows", async () => {
  (prisma.productReview.findMany as Mock).mockResolvedValue([
    { id: "r1", text: "Great turmeric, fast delivery.", productTitle: "Turmeric" },
    { id: "r2", text: "   " },
  ]);
  const docs = await collectSourceDocs();
  const reviews = docs.filter((d) => d.sourceType === "review");
  expect(reviews).toHaveLength(1);
  expect(reviews[0]).toMatchObject({ sourceId: "r1", metadata: { title: "Turmeric" } });
});
