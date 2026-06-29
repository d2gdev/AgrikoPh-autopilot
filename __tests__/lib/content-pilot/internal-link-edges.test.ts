import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  articleBlogHandleFromSeoData,
  buildInternalLinkEdges,
  classifyInternalLink,
  replaceInternalLinkEdgesForSource,
  sourceUrlForArticle,
} from "@/lib/content-pilot/internal-link-edges";

const linksData = {
  internal: [
    { href: "/blogs/news/organic-rice-guide", text: "organic rice guide" },
    { href: "https://agrikoph.com/products/organic-black-rice", text: "Shop black rice" },
    { href: "/collections/organic-rice", text: "organic rice collection" },
    { href: "/pages/guide-to-organic-rice", text: "rice guide" },
    { href: "/policies/refund-policy", text: "refund policy" },
  ],
  external: [{ href: "https://example.com/research", text: "research" }],
  cta: [{ href: "https://agrikoph.com/products/organic-black-rice", text: "Shop black rice" }],
};

const mockPrisma = {
  internalLinkEdge: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.internalLinkEdge.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.internalLinkEdge.createMany.mockResolvedValue({ count: 0 });
});

describe("classifyInternalLink", () => {
  it("classifies article, product, collection, page, and other internal targets", () => {
    expect(classifyInternalLink("/blogs/recipes/black-rice-champorado")).toEqual({
      targetType: "article",
      targetHandle: "black-rice-champorado",
      targetUrl: "/blogs/recipes/black-rice-champorado",
    });
    expect(classifyInternalLink("https://www.agrikoph.com/products/organic-red-rice?variant=1")).toEqual({
      targetType: "product",
      targetHandle: "organic-red-rice",
      targetUrl: "/products/organic-red-rice?variant=1",
    });
    expect(classifyInternalLink("/collections/organic-rice")).toMatchObject({
      targetType: "collection",
      targetHandle: "organic-rice",
    });
    expect(classifyInternalLink("/pages/guide-to-organic-rice")).toMatchObject({
      targetType: "page",
      targetHandle: "guide-to-organic-rice",
    });
    expect(classifyInternalLink("/search?q=rice")).toMatchObject({
      targetType: "other",
      targetUrl: "/search?q=rice",
    });
  });

  it("returns null for external URLs", () => {
    expect(classifyInternalLink("https://example.com/products/rice")).toBeNull();
  });
});

describe("buildInternalLinkEdges", () => {
  it("builds edge rows and preserves CTA state", () => {
    const capturedAt = new Date("2026-06-24T12:00:00.000Z");
    const edges = buildInternalLinkEdges({
      jobRunId: "job-1",
      sourceType: "article",
      sourceHandle: "rice-recipes",
      sourceUrl: "/blogs/recipes/rice-recipes",
      linksData,
      capturedAt,
    });

    expect(edges).toHaveLength(5);
    expect(edges.find((edge) => edge.targetType === "product")).toMatchObject({
      targetHandle: "organic-black-rice",
      isCta: true,
      capturedAt,
    });
    expect(edges.find((edge) => edge.targetType === "article")).toMatchObject({
      sourceHandle: "rice-recipes",
      targetHandle: "organic-rice-guide",
    });
  });
});

describe("replaceInternalLinkEdgesForSource", () => {
  it("deletes existing source edges before inserting current edges", async () => {
    const count = await replaceInternalLinkEdgesForSource(mockPrisma as any, {
      sourceType: "article",
      sourceHandle: "rice-recipes",
      linksData,
    });

    expect(count).toBe(5);
    expect(mockPrisma.internalLinkEdge.deleteMany).toHaveBeenCalledWith({
      where: { sourceType: "article", sourceHandle: "rice-recipes" },
    });
    expect(mockPrisma.internalLinkEdge.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ targetType: "product", targetHandle: "organic-black-rice" }),
      ]),
    });
  });
});

describe("article source helpers", () => {
  it("derives source URLs and blog handles", () => {
    expect(sourceUrlForArticle("foo", "recipes")).toBe("/blogs/recipes/foo");
    expect(sourceUrlForArticle("foo", null)).toBe("/blogs/news/foo");
    expect(articleBlogHandleFromSeoData({ blogHandle: "recipes" })).toBe("recipes");
    expect(articleBlogHandleFromSeoData({})).toBeNull();
  });
});
