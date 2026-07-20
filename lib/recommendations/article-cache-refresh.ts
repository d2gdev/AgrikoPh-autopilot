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
const ApprovedArticleTemplateRoundTrip = z.object({
  articleId: z.literal(ARTICLE_ID),
  blogId: z.literal(BLOG_ID),
  blogHandle: z.literal(BLOG_HANDLE),
  handle: z.literal(ARTICLE_HANDLE),
  canonicalUrl: z.literal(CANONICAL_URL),
  operation: z.literal("custom_to_default_to_custom"),
  originalTemplateSuffix: z.literal(ARTICLE_HANDLE),
  bodyBytes: z.number().int().positive(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  summarySha256: z.string().regex(/^[a-f0-9]{64}$/),
  tagsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  titleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  isPublished: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
  stateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

type Db = typeof prisma;
type ApprovedPayload = z.infer<typeof ApprovedArticleCacheRefresh>;
type ApprovedRoundTripPayload =
  z.infer<typeof ApprovedArticleTemplateRoundTrip>;
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

function stateWithTemplateSuffix(
  article: ShopifyArticle,
  templateSuffix: string | null,
): ShopifyArticle {
  return { ...article, templateSuffix };
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

function approvedRoundTripPayload(
  article: ShopifyArticle,
): ApprovedRoundTripPayload {
  return ApprovedArticleTemplateRoundTrip.parse({
    articleId: article.id,
    blogId: article.blog?.id,
    blogHandle: article.blog?.handle,
    handle: article.handle,
    canonicalUrl: CANONICAL_URL,
    operation: "custom_to_default_to_custom",
    originalTemplateSuffix: article.templateSuffix,
    bodyBytes: Buffer.byteLength(article.body),
    bodySha256: sha256(article.body),
    summarySha256: sha256(article.summary),
    tagsSha256: sha256(JSON.stringify(article.tags)),
    titleSha256: sha256(article.title),
    isPublished: article.isPublished,
    publishedAt: article.publishedAt,
    stateSha256: stateSha256(article),
  });
}

function roundTripTargetEntityId(
  payload: ApprovedRoundTripPayload,
): string {
  return `${payload.articleId}:template-round-trip:${payload.stateSha256}`;
}

function roundTripPayloadMatches(
  article: ShopifyArticle,
  payload: ApprovedRoundTripPayload,
): boolean {
  try {
    return JSON.stringify(approvedRoundTripPayload(article))
      === JSON.stringify(payload);
  } catch {
    return false;
  }
}

type RenderEvidence = {
  status: number;
  bytes: number;
  h1Count: number;
  torStoryCount: number;
};

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function renderIsCorrect(evidence: RenderEvidence): boolean {
  return evidence.status === 200
    && evidence.h1Count >= 1
    && evidence.torStoryCount >= 1;
}

async function fetchCanonicalRender(
  phase: "intermediate" | "final" | "recovery",
): Promise<RenderEvidence> {
  const url = new URL(CANONICAL_URL);
  url.searchParams.set(
    "autopilot_template_round_trip",
    `${phase}-${Date.now()}`,
  );
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const html = await response.text();
  return {
    status: response.status,
    bytes: Buffer.byteLength(html),
    h1Count: countMatches(html, /<h1\b/gi),
    torStoryCount: countMatches(html, /ag-tor-story/gi),
  };
}

async function updateTemplateSuffix(
  templateSuffix: string | null,
): Promise<void> {
  const data = await shopifyFetch<{
    articleUpdate: {
      article: { id: string; templateSuffix: string | null } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(`
    mutation RoundTripApprovedArticleTemplate(
      $id: ID!
      $article: ArticleUpdateInput!
    ) {
      articleUpdate(id: $id, article: $article) {
        article { id templateSuffix }
        userErrors { code field message }
      }
    }
  `, {
    id: ARTICLE_ID,
    article: { templateSuffix },
  });
  if (data.articleUpdate.userErrors.length > 0) {
    throw new Error(data.articleUpdate.userErrors[0]!.message);
  }
  if (data.articleUpdate.article?.id !== ARTICLE_ID
    || data.articleUpdate.article.templateSuffix !== templateSuffix) {
    throw new Error("Shopify returned the wrong article template suffix");
  }
}

async function restoreOriginalTemplate(input: {
  payload: ApprovedRoundTripPayload;
  observed?: ShopifyArticle;
}): Promise<{
  restored: boolean;
  article: ShopifyArticle | null;
  attempts: number;
  error: string | null;
}> {
  let observed = input.observed ?? null;
  let attempts = 0;
  let lastError: string | null = null;
  if (!observed) {
    try {
      observed = await fetchExactArticle();
    } catch (error) {
      lastError = String(error);
    }
  }
  if (observed
    && observed.templateSuffix === input.payload.originalTemplateSuffix
    && roundTripPayloadMatches(observed, input.payload)) {
    return { restored: true, article: observed, attempts, error: null };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    attempts++;
    try {
      await updateTemplateSuffix(
        input.payload.originalTemplateSuffix,
      );
    } catch (error) {
      lastError = String(error);
    }
    try {
      observed = await fetchExactArticle();
      if (observed.templateSuffix
          === input.payload.originalTemplateSuffix
        && roundTripPayloadMatches(observed, input.payload)) {
        return {
          restored: true,
          article: observed,
          attempts,
          error: lastError,
        };
      }
    } catch (error) {
      lastError = String(error);
      observed = null;
    }
  }
  return {
    restored: false,
    article: observed,
    attempts,
    error: lastError,
  };
}

function parseRoundTripRecommendation(
  recommendation: Recommendation,
): ApprovedRoundTripPayload {
  if (recommendation.platform !== "shopify"
    || recommendation.actionType
      !== "round_trip_shopify_article_template"
    || recommendation.status !== "executing") {
    throw new Error(
      "Article template round-trip recommendation must be executing",
    );
  }
  if (process.env.EXECUTE_APPROVED_LIVE_ENABLED !== "true") {
    throw new Error("Live Shopify execution is disabled");
  }
  let payload: ApprovedRoundTripPayload;
  try {
    payload = ApprovedArticleTemplateRoundTrip.parse(
      JSON.parse(recommendation.proposedValue ?? "null"),
    );
  } catch {
    throw new Error(
      "Approved article template round-trip payload is invalid",
    );
  }
  if (roundTripTargetEntityId(payload)
      !== recommendation.targetEntityId) {
    throw new Error(
      "Approved article template round-trip identity is invalid",
    );
  }
  return payload;
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

export async function queueArticleTemplateRoundTripRecommendation(
  db: Db,
  input: { actor: string },
): Promise<{ recommendationId: string; created: boolean }> {
  const article = await fetchExactArticle();
  const payload = approvedRoundTripPayload(article);
  const proposedValue = JSON.stringify(payload);
  const targetId = roundTripTargetEntityId(payload);
  const snapshot = await db.rawSnapshot.findFirst({
    where: { source: "gsc" },
    orderBy: { fetchedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) throw new Error("No GSC evidence snapshot is available");

  const existing = await db.recommendation.findFirst({
    where: {
      platform: "shopify",
      actionType: "round_trip_shopify_article_template",
      targetEntityId: targetId,
      proposedValue,
    },
    select: { id: true },
  });
  if (existing) {
    return { recommendationId: existing.id, created: false };
  }

  const recommendation = await db.recommendation.create({
    data: {
      platform: "shopify",
      skillId: "article-template-round-trip",
      skillName: "Shopify article template-cache reconciliation",
      actionType: "round_trip_shopify_article_template",
      targetEntityType: "blog_article",
      targetEntityId: targetId,
      targetEntityName: CANONICAL_URL,
      currentValue: JSON.stringify({
        articleId: payload.articleId,
        blogId: payload.blogId,
        blogHandle: payload.blogHandle,
        handle: payload.handle,
        bodyBytes: payload.bodyBytes,
        bodySha256: payload.bodySha256,
        summarySha256: payload.summarySha256,
        tagsSha256: payload.tagsSha256,
        titleSha256: payload.titleSha256,
        isPublished: payload.isPublished,
        publishedAt: payload.publishedAt,
        templateSuffix: payload.originalTemplateSuffix,
        stateSha256: payload.stateSha256,
        updatedAt: article.updatedAt,
      }),
      proposedValue,
      rationale:
        "Round-trip the exact article template assignment through the identical default template to invalidate Shopify's stale no-view canonical cache, then restore the original suffix.",
      guardStatus: "clear",
      status: "pending",
      snapshotId: snapshot.id,
    },
  });
  await db.auditLog.create({
    data: {
      actor: input.actor,
      action:
        "article_template_round_trip_recommendation_queued",
      entityType: "recommendation",
      entityId: recommendation.id,
      before: {
        articleId: payload.articleId,
        templateSuffix: payload.originalTemplateSuffix,
        stateSha256: payload.stateSha256,
      },
      after: {
        recommendationId: recommendation.id,
        canonicalUrl: payload.canonicalUrl,
        operation: payload.operation,
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

export async function applyApprovedArticleTemplateRoundTripRecommendation(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  const payload = parseRoundTripRecommendation(recommendation);
  const before = await fetchExactArticle();
  if (!roundTripPayloadMatches(before, payload)) {
    throw new Error("Shopify article changed after approval");
  }

  let intermediate: ShopifyArticle | undefined;
  let intermediateRender: RenderEvidence | null = null;
  let roundTripError: unknown = null;
  try {
    await updateTemplateSuffix(null);
    intermediate = await fetchExactArticle();
    const expectedIntermediateState = stateSha256(
      stateWithTemplateSuffix(before, null),
    );
    if (intermediate.templateSuffix !== null
      || stateSha256(intermediate) !== expectedIntermediateState) {
      throw new Error(
        "Shopify default-template state did not match approval",
      );
    }
    intermediateRender = await fetchCanonicalRender("intermediate");
    if (!renderIsCorrect(intermediateRender)) {
      throw new Error(
        "Canonical storefront remained stale during template round-trip",
      );
    }
  } catch (error) {
    roundTripError = error;
  }

  const restoration = await restoreOriginalTemplate({
    payload,
    observed: intermediate,
  });
  if (!restoration.restored || !restoration.article) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action:
          "article_template_round_trip_reconciliation_needed",
        entityType: "recommendation",
        entityId: recommendation.id,
        before: {
          originalTemplateSuffix: payload.originalTemplateSuffix,
          stateSha256: payload.stateSha256,
        },
        after: {
          observedTemplateSuffix:
            restoration.article?.templateSuffix ?? null,
          observedStateSha256: restoration.article
            ? stateSha256(restoration.article)
            : null,
          restorationAttempts: restoration.attempts,
          error: restoration.error,
        },
      },
    });
    throw new Error(
      "Could not restore the original article template suffix",
    );
  }

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "article_template_round_trip_restored",
      entityType: "recommendation",
      entityId: recommendation.id,
      before: {
        intermediateTemplateSuffix:
          intermediate?.templateSuffix ?? null,
      },
      after: {
        finalTemplateSuffix: restoration.article.templateSuffix,
        stateSha256: stateSha256(restoration.article),
        restorationAttempts: restoration.attempts,
      },
    },
  });
  if (roundTripError) throw roundTripError;

  const finalRender = await fetchCanonicalRender("final");
  if (!renderIsCorrect(finalRender)) {
    throw new Error(
      "Canonical storefront remained stale after template restoration",
    );
  }
  return {
    articleId: payload.articleId,
    canonicalUrl: payload.canonicalUrl,
    bodyBytes: payload.bodyBytes,
    bodySha256: payload.bodySha256,
    stateSha256: payload.stateSha256,
    originalTemplateSuffix: payload.originalTemplateSuffix,
    intermediateTemplateSuffix: null,
    finalTemplateSuffix: restoration.article.templateSuffix,
    beforeUpdatedAt: before.updatedAt,
    intermediateUpdatedAt: intermediate?.updatedAt ?? null,
    finalUpdatedAt: restoration.article.updatedAt,
    contentChanged: false,
    intermediateRender,
    finalRender,
    restorationAttempts: restoration.attempts,
    verifiedAt: new Date().toISOString(),
  };
}

export async function reconcileInterruptedArticleTemplateRoundTrip(
  recommendation: Recommendation,
): Promise<Record<string, unknown>> {
  const payload = parseRoundTripRecommendation(recommendation);
  const observed = await fetchExactArticle();
  const isApprovedOriginal =
    roundTripPayloadMatches(observed, payload);
  const isApprovedDefault =
    observed.templateSuffix === null
    && stateSha256({
      ...observed,
      templateSuffix: payload.originalTemplateSuffix,
    }) === payload.stateSha256;
  if (!isApprovedOriginal && !isApprovedDefault) {
    throw new Error(
      "Interrupted article template round-trip state is ambiguous",
    );
  }

  const restoration = await restoreOriginalTemplate({
    payload,
    observed,
  });
  if (!restoration.restored || !restoration.article) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action:
          "article_template_round_trip_reconciliation_needed",
        entityType: "recommendation",
        entityId: recommendation.id,
        before: {
          originalTemplateSuffix: payload.originalTemplateSuffix,
          stateSha256: payload.stateSha256,
        },
        after: {
          observedTemplateSuffix:
            restoration.article?.templateSuffix ?? null,
          observedStateSha256: restoration.article
            ? stateSha256(restoration.article)
            : null,
          restorationAttempts: restoration.attempts,
          error: restoration.error,
        },
      },
    });
    throw new Error(
      "Could not restore the original article template suffix",
    );
  }
  const finalRender = await fetchCanonicalRender("recovery");
  if (!renderIsCorrect(finalRender)) {
    throw new Error(
      "Canonical storefront remained stale after interrupted round-trip recovery",
    );
  }
  return {
    articleId: payload.articleId,
    canonicalUrl: payload.canonicalUrl,
    bodySha256: payload.bodySha256,
    stateSha256: payload.stateSha256,
    finalTemplateSuffix: restoration.article.templateSuffix,
    finalUpdatedAt: restoration.article.updatedAt,
    contentChanged: false,
    finalRender,
    recovered: true,
    restorationAttempts: restoration.attempts,
    verifiedAt: new Date().toISOString(),
  };
}
