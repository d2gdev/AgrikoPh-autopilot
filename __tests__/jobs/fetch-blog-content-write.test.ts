import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn().mockResolvedValue({ id: "job-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    articleRecord: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    internalLinkEdge: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(async (ops: unknown) => Array.isArray(ops) ? Promise.all(ops) : ops),
  },
}));

vi.mock("@/lib/shopify-admin", () => ({
  fetchBlogArticles: vi.fn(),
}));

vi.mock("@/lib/content-pilot/article-snapshots", () => ({
  maybeCreateArticleSnapshot: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/content-pilot/internal-link-edges", () => ({
  articleBlogHandleFromSeoData: vi.fn(() => "news"),
  replaceInternalLinkEdgesForSource: vi.fn().mockResolvedValue(0),
  sourceUrlForArticle: vi.fn((handle: string) => `https://agrikoph.com/blogs/news/${handle}`),
}));

import { prisma } from "@/lib/db";
import { fetchBlogArticles } from "@/lib/shopify-admin";
import { fetchBlogContentHandler } from "@/jobs/fetch-blog-content";

const mockPrisma = prisma as unknown as {
  articleRecord: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  jobRun: {
    update: ReturnType<typeof vi.fn>;
  };
};

const mockFetchBlogArticles = fetchBlogArticles as ReturnType<typeof vi.fn>;

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Article/1",
    handle: "new-handle",
    blogHandle: "news",
    title: "New Handle",
    bodyHtml: "<h1>New Handle</h1><p>Organic rice article body.</p>",
    tags: [],
    authorName: "Agriko",
    publishedAt: "2026-06-25T00:00:00.000Z",
    seoTitle: "New Handle",
    seoDescription: "Organic rice article body.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchBlogArticles.mockResolvedValue([article()]);
  mockPrisma.articleRecord.findMany.mockResolvedValue([
    {
      id: "record-1",
      shopifyId: "gid://shopify/Article/1",
      handle: "old-handle",
      title: "Old Handle",
      contentHash: "old-hash",
      wordCount: 10,
      imageCount: 0,
      headingCount: 1,
      ctaCount: 0,
      internalLinkCount: 0,
      inboundCount: 0,
      seoData: {},
      linksData: { internal: [], external: [], cta: [] },
      topicsData: {},
    },
  ]);
  mockPrisma.articleRecord.update.mockResolvedValue({
    id: "record-1",
    shopifyId: "gid://shopify/Article/1",
    inboundCount: 0,
  });
  mockPrisma.articleRecord.create.mockResolvedValue({
    id: "record-new",
    shopifyId: "gid://shopify/Article/1",
    inboundCount: 0,
  });
});

describe("fetchBlogContentHandler article identity", () => {
  it("updates by existing Shopify id when the article handle changed", async () => {
    const result = await fetchBlogContentHandler();

    expect(result.status).toBe("success");
    expect(mockPrisma.articleRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "record-1" },
      data: expect.objectContaining({
        shopifyId: "gid://shopify/Article/1",
        handle: "new-handle",
      }),
    }));
    expect(mockPrisma.articleRecord.create).not.toHaveBeenCalled();
  });

  it("skips explicit handle/shopify identity conflicts instead of mutating blindly", async () => {
    mockPrisma.articleRecord.findMany.mockResolvedValue([
      {
        id: "record-handle",
        shopifyId: "gid://shopify/Article/old",
        handle: "new-handle",
        title: "Handle Owner",
        contentHash: "old-hash",
        wordCount: 10,
        imageCount: 0,
        headingCount: 1,
        ctaCount: 0,
        internalLinkCount: 0,
        inboundCount: 0,
        seoData: {},
        linksData: { internal: [], external: [], cta: [] },
        topicsData: {},
      },
      {
        id: "record-shopify",
        shopifyId: "gid://shopify/Article/1",
        handle: "old-handle",
        title: "Shopify Owner",
        contentHash: "old-hash",
        wordCount: 10,
        imageCount: 0,
        headingCount: 1,
        ctaCount: 0,
        internalLinkCount: 0,
        inboundCount: 0,
        seoData: {},
        linksData: { internal: [], external: [], cta: [] },
        topicsData: {},
      },
    ]);

    const result = await fetchBlogContentHandler();

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("Article identity conflict");
    expect(mockPrisma.articleRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.articleRecord.create).not.toHaveBeenCalled();
  });
});
