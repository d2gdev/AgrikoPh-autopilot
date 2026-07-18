import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  edges: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAppAuth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    articleRecord: { findMany: mocks.findMany, count: mocks.count },
    internalLinkEdge: { findMany: mocks.edges },
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.edges.mockResolvedValue([]);
});

describe("Content Pilot published article intelligence", () => {
  it.each([
    "@/app/api/content-pilot/articles/route",
    "@/app/api/content-pilot/topic-clusters/route",
    "@/app/api/content-pilot/link-graph/route",
  ])("excludes unpublished ArticleRecords in %s", async (modulePath) => {
    const { GET } = await import(modulePath);
    const response = await GET(new Request("https://app.example/api/content-pilot"));

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { publishedAt: { not: null } },
    }));
    if (modulePath.endsWith("/articles/route")) {
      expect(mocks.count).toHaveBeenCalledWith({
        where: { publishedAt: { not: null } },
      });
    }
  });

  it("counts link edges only when their source article is published", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { handle: "published-one", title: "Published", linksData: { internal: [], external: [] }, inboundCount: 0 },
    ]);

    const { GET } = await import("@/app/api/content-pilot/link-graph/route");
    const response = await GET(new Request("https://app.example/api/content-pilot/link-graph"));

    expect(response.status).toBe(200);
    expect(mocks.edges).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sourceType: "article",
        sourceHandle: { in: ["published-one"] },
      },
    }));
  });

  it("uses the persisted article inbound count throughout Overview", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        blogHandle: "news",
        handle: "published-one",
        title: "Published",
        linksData: { internal: [], external: [] },
        inboundCount: 7,
      },
    ]);
    mocks.edges.mockResolvedValueOnce([
      {
        sourceHandle: "published-one",
        targetType: "article",
        targetHandle: "published-one",
        targetUrl: "/blogs/news/published-one",
        anchorText: "published",
        isCta: false,
      },
    ]);

    const { GET } = await import("@/app/api/content-pilot/link-graph/route");
    const response = await GET(new Request("https://app.example/api/content-pilot/link-graph"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authorities[0]).toEqual(expect.objectContaining({
      handle: "published-one",
      inboundCount: 7,
    }));
  });
});
