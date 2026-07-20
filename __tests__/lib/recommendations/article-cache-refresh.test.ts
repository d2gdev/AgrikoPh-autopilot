import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shopify = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/shopify-admin", () => ({
  shopifyFetch: shopify.fetch,
}));
vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import {
  applyApprovedArticleCacheRefreshRecommendation,
  queueArticleCacheRefreshRecommendation,
} from "@/lib/recommendations/article-cache-refresh";

const ARTICLE_ID = "gid://shopify/Article/672983056610";
const BODY = "<p>Exact approved article body.</p>";
const BODY_SHA256 = createHash("sha256").update(BODY).digest("hex");

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTICLE_ID,
    handle: "types-of-organic-rice",
    title: "Types of Organic Rice: A Complete Guide",
    body: BODY,
    summary: "A complete guide.",
    tags: ["organic rice", "rice varieties"],
    templateSuffix: "types-of-organic-rice",
    isPublished: true,
    publishedAt: "2024-12-15T00:00:00Z",
    updatedAt: "2026-07-19T14:40:53Z",
    blog: {
      id: "gid://shopify/Blog/103995441378",
      handle: "news",
    },
    ...overrides,
  };
}

function recommendation(proposedValue: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-article-cache-refresh",
    platform: "shopify",
    actionType: "refresh_shopify_article_page_cache",
    targetEntityId: `${ARTICLE_ID}:page-cache:${BODY_SHA256}`,
    status: "executing",
    proposedValue,
    ...overrides,
  } as any;
}

describe("governed Shopify article page-cache refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EXECUTE_APPROVED_LIVE_ENABLED", "true");
  });

  it("queues the exact observed article hashes without writing Shopify", async () => {
    shopify.fetch.mockResolvedValueOnce({ article: article() });
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "gsc-snapshot" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "rec-article-cache-refresh",
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(
      queueArticleCacheRefreshRecommendation(db, { actor: "operator" }),
    ).resolves.toEqual({
      recommendationId: "rec-article-cache-refresh",
      created: true,
    });

    expect(shopify.fetch).toHaveBeenCalledTimes(1);
    const created = db.recommendation.create.mock.calls[0][0].data;
    const payload = JSON.parse(created.proposedValue);
    expect(payload).toMatchObject({
      articleId: ARTICLE_ID,
      blogHandle: "news",
      handle: "types-of-organic-rice",
      canonicalUrl:
        "https://agrikoph.com/blogs/news/types-of-organic-rice",
      bodySha256: BODY_SHA256,
    });
    expect(payload.stateSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects article drift before sending the identical-body update", async () => {
    shopify.fetch
      .mockResolvedValueOnce({ article: article() })
      .mockResolvedValueOnce({
        article: article({ body: "<p>Changed after approval.</p>" }),
      });
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "gsc-snapshot" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "rec-article-cache-refresh",
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await queueArticleCacheRefreshRecommendation(db, { actor: "operator" });
    const payload =
      db.recommendation.create.mock.calls[0][0].data.proposedValue;

    await expect(
      applyApprovedArticleCacheRefreshRecommendation(
        recommendation(payload),
      ),
    ).rejects.toThrow(/changed after approval/i);
    expect(shopify.fetch).toHaveBeenCalledTimes(2);
  });

  it("re-saves identical bytes and verifies the complete protected state", async () => {
    const before = article();
    const after = article({ updatedAt: "2026-07-20T03:20:00Z" });
    shopify.fetch
      .mockResolvedValueOnce({ article: before })
      .mockResolvedValueOnce({ article: before })
      .mockResolvedValueOnce({
        articleUpdate: {
          article: { id: ARTICLE_ID },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({ article: after });
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "gsc-snapshot" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "rec-article-cache-refresh",
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await queueArticleCacheRefreshRecommendation(db, { actor: "operator" });
    const payload =
      db.recommendation.create.mock.calls[0][0].data.proposedValue;

    await expect(
      applyApprovedArticleCacheRefreshRecommendation(
        recommendation(payload),
      ),
    ).resolves.toMatchObject({
      articleId: ARTICLE_ID,
      bodySha256: BODY_SHA256,
      beforeUpdatedAt: "2026-07-19T14:40:53Z",
      afterUpdatedAt: "2026-07-20T03:20:00Z",
      contentChanged: false,
    });

    const mutationCall = shopify.fetch.mock.calls[2]!;
    expect(mutationCall[1]).toEqual({
      id: ARTICLE_ID,
      article: { body: BODY },
    });
  });

  it("fails when Shopify read-back differs from the approved state", async () => {
    const before = article();
    shopify.fetch
      .mockResolvedValueOnce({ article: before })
      .mockResolvedValueOnce({ article: before })
      .mockResolvedValueOnce({
        articleUpdate: {
          article: { id: ARTICLE_ID },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        article: article({ summary: "Unexpected summary drift." }),
      });
    const db: any = {
      rawSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "gsc-snapshot" }),
      },
      recommendation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "rec-article-cache-refresh",
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await queueArticleCacheRefreshRecommendation(db, { actor: "operator" });
    const payload =
      db.recommendation.create.mock.calls[0][0].data.proposedValue;

    await expect(
      applyApprovedArticleCacheRefreshRecommendation(
        recommendation(payload),
      ),
    ).rejects.toThrow(/read-back.*match/i);
  });
});
