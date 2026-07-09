// lib/content-pilot/publish-draft.ts
import type { ContentProposal } from "@prisma/client";
import { shopifyFetch } from "@/lib/shopify-admin";
import { prisma } from "@/lib/db";
import { getDraftSchema } from "@/lib/content-pilot/generate-draft";
import { sanitizeHtmlServer } from "@/lib/content-pilot/sanitize-html-server";
import { getArticleFeaturedImage } from "@/lib/content-pilot/article-featured-images";
import {
  articleSystemMetafields,
  normalizeArticleSystemTags,
} from "@/lib/content-pilot/article-system-assignment";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserError { field: string[]; message: string }

// ── Module-level blog ID cache (Fix 6) ───────────────────────────────────────
let cachedDefaultBlogId: string | null = null;
const cachedBlogIds: Record<string, string> = {};

interface ArticleUpdateResponse {
  articleUpdate: {
    article: { id: string } | null;
    userErrors: UserError[];
  };
}

interface MetafieldsSetResponse {
  metafieldsSet: {
    metafields: { id: string }[] | null;
    userErrors: UserError[];
  };
}

interface ArticleCreateResponse {
  articleCreate: {
    article: { id: string; handle: string } | null;
    userErrors: UserError[];
  };
}

interface BlogListResponse {
  blogs: {
    edges: Array<{ node: { id: string } }>;
  };
}

interface ArticleExistsResponse {
  article: { id: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HANDLE_KEYS = new Set([
  "articleHandle",
  "handle",
  "publishedHandle",
  "targetArticleHandle",
  "fromArticle",
]);

const URL_KEYS = new Set([
  "articleUrl",
  "canonicalUrl",
  "page",
  "sourceUrl",
  "targetUrl",
  "url",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fromPath = extractArticleHandleFromPath(trimmed);
  if (fromPath) return fromPath;

  const handle = trimmed.replace(/^['"]|['"]$/g, "");
  return /^[a-z0-9][a-z0-9_-]*$/i.test(handle) ? handle : null;
}

function extractArticleHandleFromPath(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split(/[?#]/)[0] ?? raw;
  }

  const parts = path.split("/").filter(Boolean);
  const blogIndex = parts.findIndex((part) => part === "blogs");
  if (blogIndex === -1 || parts.length <= blogIndex + 2) return null;

  const candidate = parts[blogIndex + 2];
  if (!candidate) return null;

  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
}

function findArticleHandleInJson(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArticleHandleInJson(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (HANDLE_KEYS.has(key)) {
      const handle = normalizeHandle(nestedValue);
      if (handle) return handle;
    }

    if (URL_KEYS.has(key) && typeof nestedValue === "string") {
      const handle = extractArticleHandleFromPath(nestedValue);
      if (handle) return handle;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const handle = findArticleHandleInJson(nestedValue, depth + 1);
    if (handle) return handle;
  }

  return null;
}

export function resolveArticleHandle(proposal: ContentProposal): string | null {
  return (
    normalizeHandle(proposal.articleHandle) ??
    normalizeHandle(proposal.publishedHandle) ??
    findArticleHandleInJson(proposal.proposedState) ??
    findArticleHandleInJson(proposal.sourceData) ??
    findArticleHandleInJson(proposal.draftContent)
  );
}

function requireArticleHandle(proposal: ContentProposal): string {
  const handle = resolveArticleHandle(proposal);
  if (!handle) {
    throw new Error(
      `Proposal type "${proposal.proposalType}" requires an articleHandle or a Shopify article URL in proposal data`
    );
  }
  return handle;
}

export function resolveInternalLinkSourceHandle(proposal: ContentProposal): string | null {
  const proposedState = proposal.proposedState as Record<string, unknown>;
  const sourceData = proposal.sourceData as Record<string, unknown>;
  return (
    normalizeHandle(proposedState.fromArticle) ??
    normalizeHandle(sourceData.suggestedSource) ??
    normalizeHandle(sourceData.fromArticle) ??
    resolveArticleHandle(proposal)
  );
}

function requireInternalLinkSourceHandle(proposal: ContentProposal): string {
  const handle = resolveInternalLinkSourceHandle(proposal);
  if (!handle) {
    throw new Error(
      'Internal-link proposal requires proposedState.fromArticle or sourceData.suggestedSource'
    );
  }
  return handle;
}

function assertNoUserErrors(errors: UserError[]): void {
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.map((e) => e.message).join("; ")), { userErrors: errors });
  }
}

async function getArticleGid(handle: string): Promise<string> {
  const data = await shopifyFetch<{ articles: { edges: Array<{ node: { id: string } }> } }>(
    `query ArticleByHandle($query: String!) {
      articles(first: 1, query: $query) {
        edges { node { id } }
      }
    }`,
    { query: `handle:'${handle.replace(/'/g, "\\'")}'` }
  );
  const gid = data.articles.edges[0]?.node?.id;
  if (!gid) {
    const indexed = await prisma.articleRecord.findUnique({
      where: { handle },
      select: { shopifyId: true },
    });
    if (indexed?.shopifyId) {
      const current = await shopifyFetch<ArticleExistsResponse>(
        `query ArticleExists($id: ID!) {
          article(id: $id) { id }
        }`,
        { id: indexed.shopifyId }
      );
      if (current.article?.id) return current.article.id;
    }
  }
  if (!gid) {
    // The target article no longer exists in Shopify (e.g. deleted after the
    // proposal was created). Surface an actionable message instead of a bare
    // "not found" — do not attempt auto-creation.
    throw new Error(
      `Target article '${handle}' no longer exists in Shopify — recreate it or reject this proposal.`
    );
  }
  return gid;
}

async function getDefaultBlogId(): Promise<string> {
  if (cachedDefaultBlogId) return cachedDefaultBlogId;
  const data = await shopifyFetch<BlogListResponse>(
    `query { blogs(first: 1) { edges { node { id } } } }`
  );
  const gid = data.blogs.edges[0]?.node?.id;
  if (!gid) throw new Error("No blog found in Shopify store");
  cachedDefaultBlogId = gid;
  return gid;
}

async function getBlogIdByHandle(handle: string): Promise<string> {
  if (cachedBlogIds[handle]) return cachedBlogIds[handle];
  const data = await shopifyFetch<{ blogs: { edges: Array<{ node: { id: string; handle: string } }> } }>(
    `query { blogs(first: 20) { edges { node { id handle } } } }`
  );
  const match = data.blogs.edges.find(({ node }) => node.handle === handle);
  if (!match) throw new Error(`Blog with handle "${handle}" not found`);
  cachedBlogIds[handle] = match.node.id;
  return match.node.id;
}

// ── Publish handlers ──────────────────────────────────────────────────────────

async function publishSeoFix(
  articleHandle: string,
  draft: { metaTitle: string; metaDescription: string }
): Promise<string> {
  const articleId = await getArticleGid(articleHandle);
  // ArticleUpdateInput has no `seo` field — SEO title/description are stored as
  // metafields under the `global` namespace (title_tag / description_tag).
  const data = await shopifyFetch<MetafieldsSetResponse>(
    `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: articleId,
          namespace: "global",
          key: "title_tag",
          value: draft.metaTitle,
          type: "single_line_text_field",
        },
        {
          ownerId: articleId,
          namespace: "global",
          key: "description_tag",
          value: draft.metaDescription,
          type: "multi_line_text_field",
        },
      ],
    }
  );
  assertNoUserErrors(data.metafieldsSet.userErrors);
  return articleId;
}

async function publishInternalLink(
  articleHandle: string,
  draft: { suggestedParagraph: string },
  proposalId: string
): Promise<string> {
  const articleId = await getArticleGid(articleHandle);

  // Fetch current body
  const current = await shopifyFetch<{ article: { body: string } | null }>(
    `query ArticleBody($id: ID!) { article(id: $id) { body } }`,
    { id: articleId }
  );
  if (!current.article) throw new Error("Article not found when fetching body");
  const existingBody = current.article.body;

  // Idempotency guard: wrap the appended paragraph in a stable marker keyed on the
  // proposal id. If the body already contains that marker (e.g. a retry after a
  // partial failure, or a double-publish), skip the append — this is robust where
  // fuzzy substring matching is not.
  const marker = `data-cp-link="${proposalId}"`;
  if (existingBody.includes(marker)) {
    return articleId;
  }
  const paragraphHtml = `<p ${marker}>${sanitizeHtmlServer(draft.suggestedParagraph)}</p>`;
  const newBody = existingBody + "\n\n" + paragraphHtml;

  const data = await shopifyFetch<ArticleUpdateResponse>(
    `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    { id: articleId, article: { body: newBody } }
  );
  assertNoUserErrors(data.articleUpdate.userErrors);
  if (!data.articleUpdate.article) throw new Error("Shopify returned no article after update");
  return data.articleUpdate.article.id;
}

async function publishBodyHtml(
  articleHandle: string,
  draft: { bodyHtml: string }
): Promise<string> {
  const articleId = await getArticleGid(articleHandle);
  const data = await shopifyFetch<ArticleUpdateResponse>(
    `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    { id: articleId, article: { body: sanitizeHtmlServer(draft.bodyHtml) } }
  );
  assertNoUserErrors(data.articleUpdate.userErrors);
  if (!data.articleUpdate.article) throw new Error("Shopify returned no article after update");
  return data.articleUpdate.article.id;
}

async function publishNewContent(
  draft: { title: string; bodyHtml: string; tags: string[]; metaDescription: string },
  existingArticleId?: string | null,
  blogHandle?: string | null,
  targetKeyword?: string | null
): Promise<{ id: string; handle: string | null }> {
  const safeBody = sanitizeHtmlServer(draft.bodyHtml);
  const tags = normalizeArticleSystemTags({
    title: draft.title,
    bodyHtml: safeBody,
    tags: draft.tags,
    blogHandle,
    targetKeyword,
  });
  const systemMetafields = articleSystemMetafields({
    title: draft.title,
    bodyHtml: safeBody,
    tags,
    blogHandle,
    targetKeyword,
  });
  const metafields = [
    {
      namespace: "global",
      key: "title_tag",
      value: draft.title,
      type: "single_line_text_field",
    },
    {
      namespace: "global",
      key: "description_tag",
      value: draft.metaDescription,
      type: "multi_line_text_field",
    },
    ...systemMetafields,
  ];
  const featuredImage = getArticleFeaturedImage({
    title: draft.title,
    tags,
    blogHandle,
  });
  // Idempotency guard: if this proposal already created a Shopify article (e.g. a
  // retry after a partial failure or a double-publish), don't create a duplicate.
  // Instead update the existing article so it reflects the latest draft.
  if (existingArticleId) {
    const updated = await shopifyFetch<{
      articleUpdate: { article: { id: string; handle: string } | null; userErrors: UserError[] };
    }>(
      `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
        articleUpdate(id: $id, article: $article) {
          article { id handle }
          userErrors { field message }
        }
      }`,
      {
        id: existingArticleId,
        article: {
          title: draft.title,
          body: safeBody,
          tags,
          metafields,
        },
      }
    );
    assertNoUserErrors(updated.articleUpdate.userErrors);
    if (updated.articleUpdate.article) {
      return updated.articleUpdate.article;
    }
    return { id: existingArticleId, handle: null };
  }
  const blogId = blogHandle ? await getBlogIdByHandle(blogHandle) : await getDefaultBlogId();
  const data = await shopifyFetch<ArticleCreateResponse>(
    `mutation ArticleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id handle }
        userErrors { field message }
      }
    }`,
    {
      article: {
        blogId,
        title: draft.title,
        body: safeBody,
        tags,
        ...(featuredImage ? { image: featuredImage } : {}),
        isPublished: true,
        author: { name: "Agriko" },
        metafields,
      },
    }
  );
  assertNoUserErrors(data.articleCreate.userErrors);
  if (!data.articleCreate.article) throw new Error("Shopify returned no article after create");
  return data.articleCreate.article;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function publishDraft(
  proposal: ContentProposal
): Promise<{ shopifyId: string; handle: string | null }> {
  if (!proposal.draftContent) throw new Error("No draft content to publish");

  // Runtime-validate the stored draft against the schema for this proposal type
  // before any Shopify mutation — draftContent is persisted JSON and may be stale,
  // hand-edited, or partial.
  const parsed = getDraftSchema(proposal.proposalType).safeParse(proposal.draftContent);
  if (!parsed.success) {
    throw new Error(
      `Invalid draft content for proposal type "${proposal.proposalType}": ${parsed.error.message}`
    );
  }
  const draft = parsed.data as Record<string, unknown>;

  // Schema validation only guarantees JSON shape. Add stronger content checks
  // before any Shopify mutation so a corrupted/empty draft cannot be published.
  if (proposal.proposalType === "seo-fix") {
    const metaTitle = typeof draft.metaTitle === "string" ? draft.metaTitle : "";
    const metaDescription = typeof draft.metaDescription === "string" ? draft.metaDescription : "";
    if (!metaTitle.trim()) {
      throw new Error('Cannot publish seo-fix: metaTitle is empty.');
    }
    if (!metaDescription.trim()) {
      throw new Error('Cannot publish seo-fix: metaDescription is empty.');
    }
  } else if (proposal.proposalType !== "internal-link") {
    // new-content, content-refresh, thin-content all carry bodyHtml.
    const bodyHtml = typeof draft.bodyHtml === "string" ? draft.bodyHtml : "";
    if (!bodyHtml.trim()) {
      throw new Error(
        `Cannot publish "${proposal.proposalType}": bodyHtml is empty.`
      );
    }
    if (!/<[a-z][\s\S]*>/i.test(bodyHtml)) {
      throw new Error(
        `Cannot publish "${proposal.proposalType}": bodyHtml contains no HTML markup.`
      );
    }
  }

  let shopifyId: string;
  let handle: string | null = resolveArticleHandle(proposal);

  switch (proposal.proposalType) {
    case "seo-fix":
      shopifyId = await publishSeoFix(
        requireArticleHandle(proposal),
        draft as { metaTitle: string; metaDescription: string }
      );
      break;
    case "internal-link":
      handle = requireInternalLinkSourceHandle(proposal);
      shopifyId = await publishInternalLink(
        handle,
        draft as { suggestedParagraph: string },
        proposal.id
      );
      break;
    case "new-content": {
      const ps = proposal.proposedState as Record<string, unknown>;
      const blogHandle = typeof ps.blogHandle === "string" && ps.blogHandle ? ps.blogHandle : null;
      const targetKeyword =
        typeof ps.targetKeyword === "string" && ps.targetKeyword ? ps.targetKeyword : null;
      const created = await publishNewContent(
        draft as { title: string; bodyHtml: string; tags: string[]; metaDescription: string },
        proposal.shopifyArticleId,
        blogHandle,
        targetKeyword
      );
      shopifyId = created.id;
      handle = created.handle ?? handle;
      break;
    }
    default:
      // content-refresh, thin-content
      shopifyId = await publishBodyHtml(
        requireArticleHandle(proposal),
        draft as { bodyHtml: string }
      );
  }

  return { shopifyId, handle };
}
