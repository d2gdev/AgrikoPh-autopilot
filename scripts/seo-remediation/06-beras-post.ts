/**
 * Task 9 — Rewrite the wrong-market "beras coklat organik" post (Indonesian/Malay
 * intent) into PH-English brown-rice intent, change its handle, and add a 301
 * redirect from the old URL to the new one.
 *
 *   Preview:  cd /opt/autopilot && npx tsx scripts/seo-remediation/06-beras-post.ts
 *   Apply:    cd /opt/autopilot && APPLY=1 npx tsx scripts/seo-remediation/06-beras-post.ts
 *
 * ---------------------------------------------------------------------------
 * API USED: Shopify Admin GraphQL 2025-01 (via gql() -> lib/shopify-admin.ts).
 * NO REST. Article GraphQL mutations are GA since 2024-10, so available in 2025-01.
 *
 * VERIFIED against shopify.dev Admin GraphQL 2025-01 docs (2026-06-24):
 *
 *   Find blog by handle:     blogs(query:"handle:news") { nodes { id handle } }
 *   Find article by handle:  Blog.articles(query:"handle:<old>") { nodes { id handle } }
 *
 *   Update article (incl. handle change):
 *     articleUpdate(id: ID!, article: ArticleUpdateInput!): ArticleUpdatePayload
 *       ArticleUpdateInput { title body summary handle tags isPublished metafields ... }
 *       Note: we set `handle` to the new slug. We do NOT use Shopify's
 *       `redirectNewHandle` flag because we create the redirect explicitly below
 *       (matching the idempotent urlRedirectCreate approach used in 01-redirects.ts),
 *       which keeps the redirect map auditable in one place.
 *       Payload: { article { id handle } userErrors { field message } }
 *
 *   Create redirect (same as 01-redirects.ts):
 *     urlRedirects(first, query:"path:/blogs/news/<old>") { nodes { id path target } }
 *     urlRedirectCreate(urlRedirect: { path, target }) {
 *       urlRedirect { id path target } userErrors { field message }
 *     }
 *
 * SEO FIELD MAPPING:
 *   Articles have NO `seo` input field. <title>/meta description are stored as
 *   metafields  global/title_tag  and  global/description_tag
 *   (single_line_text_field) — the pair read by fetchBlogArticles() in
 *   lib/shopify-admin.ts.
 *       BERAS_POST.seoTitle       -> global/title_tag
 *       BERAS_POST.seoDescription -> global/description_tag
 * ---------------------------------------------------------------------------
 */
import fs from "node:fs";
import path from "node:path";

import { gql, assertNoUserErrors, APPLY, summary, log, banner } from "./_lib";
import { BERAS_POST } from "./_data";
import { getArticleFeaturedImage } from "../../lib/content-pilot/article-featured-images";

type SummaryRow = { item: string; status: string };
const rows: SummaryRow[] = [];

const CONTENT_DIR = path.join(__dirname, "content");

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface BlogNode {
  id: string;
  handle: string;
}
interface ArticleNode {
  id: string;
  handle: string;
}
interface ArticleUpdatePayload {
  article: { id: string; handle: string } | null;
  userErrors: Array<{ field?: string[] | null; message: string }>;
}
interface UrlRedirectNode {
  id: string;
  path: string;
  target: string;
}
interface UrlRedirectCreatePayload {
  urlRedirect: UrlRedirectNode | null;
  userErrors: Array<{ field?: string[] | null; message: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read body HTML from content/<newHandle>.html; throw clearly if missing. */
function readBody(handle: string): string {
  const file = path.join(CONTENT_DIR, `${handle}.html`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing body content for "${handle}": expected file ${file}. ` +
        `Create it before running this script.`
    );
  }
  const html = fs.readFileSync(file, "utf8").trim();
  if (!html) throw new Error(`Body content file is empty: ${file}`);
  return html;
}

async function blogIdByHandle(handle: string): Promise<BlogNode | null> {
  const d = await gql<{ blogs: { nodes: BlogNode[] } }>(
    `query($q: String!) {
      blogs(first: 50, query: $q) {
        nodes { id handle }
      }
    }`,
    { q: `handle:${handle}` }
  );
  return d.blogs.nodes.find((b) => b.handle === handle) ?? null;
}

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
  return d.blog?.articles.nodes.find((a) => a.handle === handle) ?? null;
}

/** Return the existing redirect for `path`, or null. (Same shape as 01-redirects.ts.) */
async function fetchExistingRedirect(redirectPath: string): Promise<UrlRedirectNode | null> {
  const d = await gql<{ urlRedirects: { nodes: UrlRedirectNode[] } }>(
    `query($q: String!) {
      urlRedirects(first: 250, query: $q) {
        nodes { id path target }
      }
    }`,
    { q: `path:${redirectPath}` }
  );
  return d.urlRedirects.nodes.find((n) => n.path === redirectPath) ?? null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  banner("06-beras-post — rewrite wrong-market post + add redirect");

  const fromPath = `/blogs/${BERAS_POST.blog}/${BERAS_POST.oldHandle}`;
  const toPath = `/blogs/${BERAS_POST.blog}/${BERAS_POST.newHandle}`;
  log(`\nRewrite ${fromPath}\n     -> ${toPath}\n`);

  // Read body up front so a missing content file fails loudly, even in dry-run.
  const bodyHtml = readBody(BERAS_POST.newHandle);
  const featuredImage = getArticleFeaturedImage({
    handle: BERAS_POST.newHandle,
    title: BERAS_POST.title,
    tags: ["brown rice", "organic rice", "philippines"],
    blogHandle: BERAS_POST.blog,
  });

  const blog = await blogIdByHandle(BERAS_POST.blog);
  if (!blog) {
    log(`  [NOT FOUND] blog "${BERAS_POST.blog}" does not exist`);
    rows.push({ item: "rewrite article", status: "BLOG NOT FOUND" });
    summary(rows);
    return;
  }

  // ---- 1. Locate the article (old handle first, then new handle in case of re-run) ----
  let article = await articleByHandle(blog.id, BERAS_POST.oldHandle);
  let foundBy = "old handle";
  if (!article) {
    article = await articleByHandle(blog.id, BERAS_POST.newHandle);
    foundBy = "new handle (already migrated)";
  }

  if (!article) {
    log(`  [NOT FOUND] no article at handle "${BERAS_POST.oldHandle}" or "${BERAS_POST.newHandle}"`);
    rows.push({ item: "rewrite article", status: "ARTICLE NOT FOUND" });
  } else {
    const alreadyMigrated = article.handle === BERAS_POST.newHandle;
    log(`  Article found by ${foundBy} (id: ${article.id}, handle: ${article.handle})`);
    log(`  WOULD UPDATE:`);
    log(`      title           -> ${BERAS_POST.title}`);
    log(`      handle          -> ${BERAS_POST.newHandle}${alreadyMigrated ? " (unchanged)" : ""}`);
    log(`      seo.title_tag   -> ${BERAS_POST.seoTitle}`);
    log(`      seo.description -> ${BERAS_POST.seoDescription}`);
    log(`      image           -> ${featuredImage?.url ?? "(none)"}`);
    log(`      body            -> ${bodyHtml.length} chars from content/${BERAS_POST.newHandle}.html`);

    if (!APPLY) {
      rows.push({ item: "rewrite article", status: "would update" });
    } else {
      const res = await gql<{ articleUpdate: ArticleUpdatePayload }>(
        `mutation($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) {
            article { id handle }
            userErrors { field message }
          }
        }`,
        {
          id: article.id,
          article: {
            title: BERAS_POST.title,
            handle: BERAS_POST.newHandle,
            body: bodyHtml,
            ...(featuredImage ? { image: featuredImage } : {}),
            metafields: [
              { namespace: "global", key: "title_tag", type: "single_line_text_field", value: BERAS_POST.seoTitle },
              { namespace: "global", key: "description_tag", type: "single_line_text_field", value: BERAS_POST.seoDescription },
            ],
          },
        }
      );
      assertNoUserErrors("articleUpdate beras", res.articleUpdate.userErrors);
      log(`      UPDATED (id: ${res.articleUpdate.article?.id}, handle: ${res.articleUpdate.article?.handle})`);
      rows.push({ item: "rewrite article", status: "updated" });
    }
  }

  // ---- 2. Redirect old URL -> new URL (idempotent, same approach as 01-redirects.ts) ----
  const redirectLabel = `${fromPath} -> ${toPath}`;
  const existing = await fetchExistingRedirect(fromPath);
  if (existing) {
    log(`\n  [redirect] exists (id: ${existing.id}, target: ${existing.target}) — skip`);
    rows.push({ item: `redirect ${redirectLabel}`, status: "exists (skip)" });
  } else if (!APPLY) {
    log(`\n  [redirect] WOULD CREATE  ${redirectLabel}`);
    rows.push({ item: `redirect ${redirectLabel}`, status: "would create" });
  } else {
    const res = await gql<{ urlRedirectCreate: UrlRedirectCreatePayload }>(
      `mutation($input: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $input) {
          urlRedirect { id path target }
          userErrors { field message }
        }
      }`,
      { input: { path: fromPath, target: toPath } }
    );
    assertNoUserErrors("urlRedirectCreate beras", res.urlRedirectCreate.userErrors);
    log(`\n  [redirect] CREATED ${redirectLabel} (id: ${res.urlRedirectCreate.urlRedirect?.id})`);
    rows.push({ item: `redirect ${redirectLabel}`, status: "created" });
  }

  summary(rows);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
