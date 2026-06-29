/**
 * Task 10 — Inject internal product links into high-traffic rice articles.
 *
 * Each plan in INTERNAL_LINK_PLANS appends a styled "Shop these products"
 * block to the article body. The block is idempotent: insertion is skipped
 * when the marker comment already exists.
 *
 * Usage:
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/08-internal-links.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/08-internal-links.ts
 *
 * ---------------------------------------------------------------------------
 * VERIFIED against Shopify Admin GraphQL 2025-01 docs (shopify.dev):
 *
 *   Find blog by handle:
 *     blogs(first: Int, query: String): BlogConnection
 *       nodes { id handle }
 *     Filter: query: "handle:<handle>"  (substring match — verify exact).
 *
 *   Find article in blog by handle:
 *     blog.articles(first: Int, query: String): ArticleConnection
 *       nodes { id handle body }
 *     Filter: query: "handle:<handle>"  (substring match — verify exact).
 *
 *   Update:
 *     articleUpdate(id: ID!, article: ArticleUpdateInput!): ArticleUpdatePayload
 *       ArticleUpdateInput { body: HTML }
 *       Payload: { article { id handle } userErrors { field message } }
 * ---------------------------------------------------------------------------
 */

import { gql, assertNoUserErrors, APPLY, summary, log, banner } from "./_lib";
import { INTERNAL_LINK_PLANS, type InternalLinkPlan } from "./_data";

// ── GraphQL shapes ────────────────────────────────────────────────────────────

interface BlogNode {
  id: string;
  handle: string;
}

interface BlogsResult {
  blogs: { nodes: BlogNode[] };
}

interface ArticleNode {
  id: string;
  handle: string;
  body: string;
}

interface ArticlesResult {
  blog: {
    articles: {
      nodes: ArticleNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

interface ArticleUpdateResult {
  articleUpdate: {
    article: { id: string; handle: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MARKER = "<!-- agriko:internal-links-v1 -->";

/** Unique marker comment so we can detect and skip idempotently. */
function buildLinkBlock(plan: InternalLinkPlan): string {
  const items = plan.links
    .map(
      (l) =>
        `    <li><a href="${l.url}">${l.text}</a> — ${l.blurb}</li>`,
    )
    .join("\n");

  return `\n${MARKER}\n<div class="agriko-related-products" style="margin-top:2em;padding:1em 1.25em;background:#f9f5f0;border-radius:8px;">\n  <p><strong>Shop these products:</strong></p>\n  <ul>\n${items}\n  </ul>\n</div>`;
}

async function fetchBlogId(blogHandle: string): Promise<string | null> {
  const data = await gql<BlogsResult>(
    `query($q: String!) {
      blogs(first: 10, query: $q) {
        nodes { id handle }
      }
    }`,
    { q: `handle:${blogHandle}` },
  );
  return data.blogs.nodes.find((b) => b.handle === blogHandle)?.id ?? null;
}

async function fetchArticle(blogId: string, articleHandle: string): Promise<ArticleNode | null> {
  // blog.articles does not support a query filter — page through all articles
  // and match by handle in JS. Blogs are typically small (<250 articles).
  let after: string | null = null;
  do {
    const pageData: ArticlesResult = await gql<ArticlesResult>(
      `query($blogId: ID!, $after: String) {
        blog(id: $blogId) {
          articles(first: 250, after: $after) {
            nodes { id handle body }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { blogId, after },
    );
    const conn = pageData.blog?.articles;
    if (!conn) return null;
    const match = conn.nodes.find((a: ArticleNode) => a.handle === articleHandle);
    if (match) return match;
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return null;
}

async function updateArticleBody(articleId: string, body: string): Promise<void> {
  const data = await gql<ArticleUpdateResult>(
    `mutation($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id handle }
        userErrors { field message }
      }
    }`,
    { id: articleId, article: { body } },
  );
  assertNoUserErrors("articleUpdate", data.articleUpdate.userErrors);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function processPlan(
  plan: InternalLinkPlan,
  rows: Array<{ item: string; status: string }>,
) {
  const label = `[${plan.label}] /blogs/${plan.blogHandle}/${plan.articleHandle}`;

  // 1. Resolve blog GID
  const blogId = await fetchBlogId(plan.blogHandle);
  if (!blogId) {
    log(`  ERROR   ${label} — blog handle "${plan.blogHandle}" not found`);
    rows.push({ item: label, status: "error: blog not found" });
    return;
  }

  // 2. Resolve article
  const article = await fetchArticle(blogId, plan.articleHandle);
  if (!article) {
    log(`  SKIP    ${label} — article handle not found (may not exist yet)`);
    rows.push({ item: label, status: "skip: article not found" });
    return;
  }

  // 3. Idempotency check
  if (article.body.includes(MARKER)) {
    log(`  EXISTS  ${label} — link block already present`);
    rows.push({ item: label, status: "exists" });
    return;
  }

  const block = buildLinkBlock(plan);
  const newBody = article.body + block;

  if (!APPLY) {
    log(`  WOULD INSERT  ${label}`);
    log(`  Block preview:\n${block.slice(0, 200)}...`);
    rows.push({ item: label, status: "would insert" });
    return;
  }

  await updateArticleBody(article.id, newBody);
  log(`  UPDATED ${label}`);
  rows.push({ item: label, status: "updated" });
}

async function main() {
  banner("08-internal-links — inject related-product blocks into rice articles");

  log(`\nProcessing ${INTERNAL_LINK_PLANS.length} article(s)...\n`);

  const rows: Array<{ item: string; status: string }> = [];

  for (const plan of INTERNAL_LINK_PLANS) {
    await processPlan(plan, rows);
  }

  summary(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
