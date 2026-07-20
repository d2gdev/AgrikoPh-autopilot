import { createHash } from "node:crypto";
import type { Recommendation } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { shopifyFetch } from "@/lib/shopify-admin";

const ARTICLE_ID = "gid://shopify/Article/672983056610";
const BLOG_ID = "gid://shopify/Blog/103995441378";
const BLOG_HANDLE = "news";
const ARTICLE_HANDLE = "types-of-organic-rice";
const CANONICAL_URL =
  "https://agrikoph.com/blogs/news/types-of-organic-rice";

const ApprovedArticleCacheRefresh = z.object({
  articleId: z.literal(ARTICLE_ID),
  blogId: z.literal(BLOG_ID),
  blogHandle: z.literal(BLOG_HANDLE),
  handle: z.literal(ARTICLE_HANDLE),
  canonicalUrl: z.literal(CANONICAL_URL),
  bodyBytes: z.number().int().positive(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  stateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

type Db = typeof prisma;
type ApprovedPayload = z.infer<typeof ApprovedArticleCacheRefresh>;
type ShopifyArticle = {
  id: string;
  blog: { id: string; handle: string } | null;
  body: string;
  handle: string;
  isPublished: boolean;
  publishedAt: string | null;
  summary: string;
  tags: string[];
  templateSuffix: string | null;
  title: string;
  updatedAt: string;
};

const ARTICLE_FIELDS = `
  id
  blog { id handle }
  body
  handle
  isPublished
  publishedAt
  summary
  tags
  templateSuffix
  title
  updatedAt
`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function protectedState(article: ShopifyArticle): Record<string, unknown> {
  return {
    id: article.id,
    blog: article.blog,
    body: article.body,
    handle: article.handle,
    isPublished: article.isPublished,
    publishedAt: article.publishedAt,
    summary: article.summary,
    tags: article.tags,
    templateSuffix: article.templateSuffix,
    title: article.title,
  };
}

function stateSha256(article: ShopifyArticle): string {
  return sha256(JSON.stringify(protectedState(article)));
}

async function fetchExactArticle(): Promise<ShopifyArticle> {
  const data = await shopifyFetch<{ article: ShopifyArticle | null }>(`
    query ApprovedArticleCacheRefresh($id: ID!) {
      article(id: $id) {
        ${ARTICLE_FIELDS}
      }
    }
  `, { id: ARTICLE_ID });
  const article = data.article;
  if (!article
    || article.id !== ARTICLE_ID
    || article.blog?.id !== BLOG_ID
    || article.blog.handle !== BLOG_HANDLE
    || article.handle !== ARTICLE_HANDLE) {
    throw new Error("Exact Shopify article identity was unavailable");
  }
  return article;
}

function approvedPayload(article: ShopifyArticle): ApprovedPayload {
  return ApprovedArticleCacheRefresh.parse({
    articleId: article.id,
    blogId: article.blog?.id,
    blogHandle: article.blog?.handle,
    handle: article.handle,
    canonicalUrl: CANONICAL_URL,
    bodyBytes: Buffer.byteLength(article.body),
    bodySha256: sha256(article.body),
    stateSha256: stateSha256(article),
  });
}

function targetEntityId(payload: ApprovedPayload): string {
  return `${payload.articleId}:page-cache:${payload.bodySha256}`;
}

export async function queueArticleCacheRefreshRecommendation(
  db: Db,
  input: { actor: string },
): Promise<{ recommendationId: string; created: boolean }> {
  const article = await fetchExactArticle();
  const payload = approvedPayload(article);
  const proposedValue = JSON.stringify(payload);
  const snapshot = await db.rawSnapshot.findFirst({
    where: { source: "gsc" },
    orderBy: { fetchedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No GSC evidence snapshot is available");

  const existing = await db.recommendation.findFirst({
    where: {
      platform: "shopify",
      actionType: "refresh_shopify_article_page_cache",
      targetEntityId: targetEntityId(payload),
      proposedValue,
      status: {
        in: [
          "pending",
          "approved",
          "override_approved",
          "executing",
          "executed",
        ],
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { recommendationId: existing.id, created: false };
  }

  const recommendation = await db.recommendation.create({
    data: {
      platform: "shopify",
      skillId: "article-page-cache-refresh",
      skillName: "Shopify article page-cache reconciliation",
      actionType: "refresh_shopify_article_page_cache",
      targetEntityType: "blog_article",
      targetEntityId: targetEntityId(payload),
      targetEntityName: CANONICAL_URL,
      currentValue: JSON.stringify({
        bodyBytes: payload.bodyBytes,
        bodySha256: payload.bodySha256,
        stateSha256: payload.stateSha256,
        updatedAt: article.updatedAt,
      }),
      proposedValue,
      rationale:
        "Re-save the exact unchanged article body to invalidate Shopify's stale canonical BlogArticleDetailsController page cache.",
      guardStatus: "clear",
      status: "pending",
      snapshotId: snapshot.id,
    },
  });
  await db.auditLog.create({
    data: {
      actor: input.actor,
      action: "article_page_cache_refresh_recommendation_queued",
      entityType: "recommendation",
      entityId: recommendation.id,
      before: {
        articleId: payload.articleId,
        bodySha256: payload.bodySha256,
        stateSha256: payload.stateSha256,
        updatedAt: article.updatedAt,
      },
      after: {
        recommendationId: recommendation.id,
        canonicalUrl: payload.canonicalUrl,
        operation: "identical_body_resave",
      },
    },
  });
  return { recommendationId: recommendation.id, created: true };
}

export async function applyApprovedArticleCacheRefreshRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  if (recommendation.platform !== "shopify"
    || recommendation.actionType !== "refresh_shopify_article_page_cache"
    || recommendation.status !== "executing") {
    throw new Error("Article cache-refresh recommendation must be executing");
  }
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") {
    throw new Error("Live Shopify execution is disabled");
  }

  let payload: ApprovedPayload;
  try {
    payload = ApprovedArticleCacheRefresh.parse(
      JSON.parse(recommendation.proposedValue ?? "null"),
    );
  } catch {
    throw new Error("Approved article cache-refresh payload is invalid");
  }
  if (targetEntityId(payload) !== recommendation.targetEntityId) {
    throw new Error("Approved article cache-refresh identity is invalid");
  }

  const before = await fetchExactArticle();
  if (sha256(before.body) !== payload.bodySha256
    || Buffer.byteLength(before.body) !== payload.bodyBytes
    || stateSha256(before) !== payload.stateSha256) {
    throw new Error("Shopify article changed after approval");
  }

  const update = await shopifyFetch<{
    articleUpdate: {
      article: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(`
    mutation RefreshApprovedArticlePageCache(
      $id: ID!
      $article: ArticleUpdateInput!
    ) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { code field message }
      }
    }
  `, {
    id: payload.articleId,
    article: { body: before.body },
  });
  if (update.articleUpdate.userErrors.length > 0) {
    throw new Error(update.articleUpdate.userErrors[0]!.message);
  }
  if (update.articleUpdate.article?.id !== payload.articleId) {
    throw new Error("Shopify returned the wrong article after cache refresh");
  }

  const after = await fetchExactArticle();
  if (sha256(after.body) !== payload.bodySha256
    || Buffer.byteLength(after.body) !== payload.bodyBytes
    || stateSha256(after) !== payload.stateSha256) {
    throw new Error(
      "Shopify article read-back did not match the approved state",
    );
  }
  return {
    articleId: payload.articleId,
    canonicalUrl: payload.canonicalUrl,
    bodyBytes: payload.bodyBytes,
    bodySha256: payload.bodySha256,
    stateSha256: payload.stateSha256,
    beforeUpdatedAt: before.updatedAt,
    afterUpdatedAt: after.updatedAt,
    contentChanged: false,
    verifiedAt: new Date().toISOString(),
  };
}
