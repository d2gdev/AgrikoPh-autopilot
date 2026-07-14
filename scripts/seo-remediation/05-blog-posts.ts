/**
 * Task 8 — Turmeric content cluster: idempotent create/update of the 5
 * TURMERIC_POSTS as Shopify blog articles. Bodies live in
 * ./content/<handle>.html and are read at run time.
 *
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/05-blog-posts.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/05-blog-posts.ts
 *
 * ---------------------------------------------------------------------------
 * API USED: Shopify Admin GraphQL 2025-01 (via gql() -> lib/shopify-admin.ts).
 * NO REST. Article GraphQL mutations have been GA since 2024-10, so they are
 * fully available in 2025-01 — no REST fallback was needed.
 *
 * VERIFIED against shopify.dev Admin GraphQL 2025-01 docs (2026-06-24):
 *
 *   Find blog by handle:
 *     blogs(first: Int, query: String): BlogConnection
 *       nodes { id handle title }
 *     Filter syntax: query: "handle:news"  (substring match -> verify exactly).
 *
 *   Find article by handle within a blog:
 *     Blog.articles(first: Int, query: String): ArticleConnection
 *       nodes { id handle }
 *     Filter syntax: query: "handle:turmeric-vs-ginger"  (verify exact match).
 *
 *   Create:
 *     articleCreate(article: ArticleCreateInput!): ArticleCreatePayload
 *       ArticleCreateInput {
 *         blogId: ID            # which blog
 *         title: String!        # on-page H1 / article title (REQUIRED)
 *         author: AuthorInput!  # { name: String! }  (REQUIRED on create)
 *         body: HTML            # bodyHtml (from content/<handle>.html)
 *         summary: HTML         # excerpt
 *         handle: String        # URL slug
 *         tags: [String!]
 *         isPublished: Boolean  # visibility
 *         metafields: [MetafieldInput!]   # used for SEO (see below)
 *       }
 *       Payload: { article { id handle } userErrors { field message } }
 *
 *   Update:
 *     articleUpdate(id: ID!, article: ArticleUpdateInput!): ArticleUpdatePayload
 *       ArticleUpdateInput { title body summary handle tags isPublished metafields ... }
 *       Payload: { article { id handle } userErrors { field message } }
 *
 * SEO FIELD MAPPING (IMPORTANT):
 *   ArticleCreateInput/ArticleUpdateInput have NO `seo` field (unlike
 *   CollectionInput which does). An article's <title> tag and meta description
 *   are stored as the standard Online Store SEO metafields:
 *       seoTitle       -> metafield  global / title_tag        (single_line_text_field)
 *       seoDescription -> metafield  global / description_tag  (single_line_text_field)
 *   This is the exact pair read back by fetchBlogArticles() in lib/shopify-admin.ts.
 *   We write them via the inline `metafields` input on the article mutation; the
 *   article is the metafield owner, so no ownerId is supplied (unlike metafieldsSet).
 *
 * userErrors: ArticleCreateUserError / ArticleUpdateUserError
 *   ({ field: [String!], message: String! }).
 * ---------------------------------------------------------------------------
 */
import fs from "node:fs";
import path from "node:path";

import { gql, assertNoUserErrors, APPLY, summary, log, banner } from "./_lib";
import { TURMERIC_POSTS, type TurmericPost } from "./_data";
import { getArticleFeaturedImage } from "../../lib/content-pilot/article-featured-images";

/** Flip to false to create/update the articles as drafts instead of live. */
const PUBLISH = true;

/** Author shown on created articles (required by ArticleCreateInput). */
const AUTHOR_NAME = "Agriko";

const CONTENT_DIR = path.join(__dirname, "content");

type SummaryRow = { item: string; status: string };
const rows: SummaryRow[] = [];

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface BlogNode {
  id: string;
  handle: string;
  title: string;
}
interface ArticleNode {
  id: string;
  handle: string;
}
interface MutationPayload {
  article: { id: string; handle: string } | null;
  userErrors: Array<{ field?: string[] | null; message: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the article body HTML from content/<handle>.html; throw clearly if missing. */
function readBody(handle: string): string {
  const file = path.join(CONTENT_DIR, `${handle}.html`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing body content for article "${handle}": expected file ${file}. ` +
        `Create it before running this script.`
    );
  }
  const html = fs.readFileSync(file, "utf8").trim();
  if (!html) throw new Error(`Body content file is empty: ${file}`);
  return html;
}

/** Resolve a blog id by handle ("news" | "recipes"). */
async function blogIdByHandle(handle: string): Promise<BlogNode | null> {
  const d = await gql<{ blogs: { nodes: BlogNode[] } }>(
    `query($q: String!) {
      blogs(first: 50, query: $q) {
        nodes { id handle title }
      }
    }`,
    { q: `handle:${handle}` }
  );
  // The query filter is a substring search, so confirm an exact match.
  return d.blogs.nodes.find((b) => b.handle === handle) ?? null;
}

/** Find an existing article in a blog by exact handle, or null. */
async function articleByHandle(blogId: string, handle: string): Promise<ArticleNode | null> {
  const d = await gql<{ blog: { articles: { nodes: ArticleNode[] } } | null }>(
    `query($blogId: ID!, $q: String!) {
      blog(id: $blogId) {
        articles(first: 50, query: $q) {
          nodes { id handle }
        }
      }
    }`,
    { blogId, q: `handle:${handle}` }
  );
  // Substring match -> verify exact handle.
  return d.blog?.articles.nodes.find((a) => a.handle === handle) ?? null;
}

/** SEO metafields for an article (title_tag / description_tag under "global"). */
function seoMetafields(post: TurmericPost) {
  return [
    {
      namespace: "global",
      key: "title_tag",
      type: "single_line_text_field",
      value: post.seoTitle,
    },
    {
      namespace: "global",
      key: "description_tag",
      type: "single_line_text_field",
      value: post.seoDescription,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  banner("05-blog-posts — turmeric content cluster (create/update articles)");
  log(`\nPublish state: ${PUBLISH ? "PUBLISHED (visible)" : "DRAFT (hidden)"}`);
  log(`Processing ${TURMERIC_POSTS.length} article(s)...\n`);

  // Resolve target blog ids once (cache by handle).
  const blogCache = new Map<string, BlogNode | null>();
  async function resolveBlog(handle: string): Promise<BlogNode | null> {
    if (!blogCache.has(handle)) blogCache.set(handle, await blogIdByHandle(handle));
    return blogCache.get(handle) ?? null;
  }

  for (const post of TURMERIC_POSTS) {
    const label = `[${post.blog}] ${post.handle}`;

    const blog = await resolveBlog(post.blog);
    if (!blog) {
      log(`  [NOT FOUND] ${label}: blog "${post.blog}" does not exist`);
      rows.push({ item: label, status: "BLOG NOT FOUND" });
      continue;
    }

    // Read the body first so a missing content file fails loudly, even in dry-run.
    const bodyHtml = readBody(post.handle);

    const existing = await articleByHandle(blog.id, post.handle);
    const verb = existing ? "UPDATE" : "CREATE";
    const featuredImage = getArticleFeaturedImage({
      handle: post.handle,
      title: post.title,
      tags: post.tags,
      blogHandle: post.blog,
    });

    log(`  WOULD ${verb}  ${label}`);
    log(`      title           -> ${post.title}`);
    log(`      seo.title_tag   -> ${post.seoTitle}`);
    log(`      seo.description -> ${post.seoDescription}`);
    log(`      summary         -> ${post.summaryHtml.slice(0, 70)}...`);
    log(`      tags            -> ${post.tags.join(", ")}`);
    log(`      image           -> ${featuredImage?.url ?? "(none)"}`);
    log(`      body            -> ${bodyHtml.length} chars from content/${post.handle}.html`);

    if (!APPLY) {
      rows.push({ item: label, status: `would ${verb.toLowerCase()}` });
      continue;
    }

    if (existing) {
      const res = await gql<{ articleUpdate: MutationPayload }>(
        `mutation($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) {
            article { id handle }
            userErrors { field message }
          }
        }`,
        {
          id: existing.id,
          article: {
            title: post.title,
            body: bodyHtml,
            summary: post.summaryHtml,
            tags: post.tags,
            isPublished: PUBLISH,
            ...(featuredImage ? { image: featuredImage } : {}),
            metafields: seoMetafields(post),
          },
        }
      );
      assertNoUserErrors(`articleUpdate ${post.handle}`, res.articleUpdate.userErrors);
      log(`      UPDATED (id: ${res.articleUpdate.article?.id})`);
      rows.push({ item: label, status: "updated" });
    } else {
      const res = await gql<{ articleCreate: MutationPayload }>(
        `mutation($article: ArticleCreateInput!) {
          articleCreate(article: $article) {
            article { id handle }
            userErrors { field message }
          }
        }`,
        {
          article: {
            blogId: blog.id,
            title: post.title,
            handle: post.handle,
            author: { name: AUTHOR_NAME },
            body: bodyHtml,
            summary: post.summaryHtml,
            tags: post.tags,
            isPublished: PUBLISH,
            ...(featuredImage ? { image: featuredImage } : {}),
            metafields: seoMetafields(post),
          },
        }
      );
      assertNoUserErrors(`articleCreate ${post.handle}`, res.articleCreate.userErrors);
      log(`      CREATED (id: ${res.articleCreate.article?.id})`);
      rows.push({ item: label, status: "created" });
    }
  }

  summary(rows);
}

main().catch((err) => {

  console.error(err);
  process.exit(1);
});
