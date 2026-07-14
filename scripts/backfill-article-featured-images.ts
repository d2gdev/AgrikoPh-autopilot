/**
 * Backfill Shopify article featured images.
 *
 * Dry-run:
 *   npx tsx scripts/backfill-article-featured-images.ts
 *
 * Apply:
 *   APPLY=1 npx tsx scripts/backfill-article-featured-images.ts
 *
 * Optional filters:
 *   BLOG_HANDLE=news
 *   HANDLES=turmeric-for-inflammation,red-rice-philippines
 *   FORCE=1
 *   SKIP_FALLBACK=1
 */
import { shopifyFetch } from "../lib/shopify-admin";
import { getArticleFeaturedImage } from "../lib/content-pilot/article-featured-images";

const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const FORCE = process.env.FORCE === "1" || process.env.FORCE === "true";
const BLOG_HANDLE = process.env.BLOG_HANDLE?.trim() || "news";
const INCLUDE_FALLBACK = !(process.env.SKIP_FALLBACK === "1" || process.env.SKIP_FALLBACK === "true");
const HANDLE_FILTER = new Set(
  (process.env.HANDLES ?? "")
    .split(",")
    .map((handle) => handle.trim())
    .filter(Boolean)
);

interface ArticleNode {
  id: string;
  handle: string;
  title: string;
  tags: string[];
  blog: { handle: string; title: string } | null;
  image: { url: string; altText: string | null } | null;
}

interface ArticlesResponse {
  articles: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: ArticleNode }>;
  };
}

interface ArticleUpdateResponse {
  articleUpdate: {
    article: { id: string; handle: string; image: { url: string; altText: string | null } | null } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
}

function log(...args: unknown[]) {

  console.log(...args);
}

function assertNoUserErrors(label: string, errors: Array<{ field?: string[] | null; message: string }> | null | undefined) {
  if (!errors?.length) return;
  throw new Error(
    `${label} failed:\n` + errors.map((error) => `  - ${(error.field ?? []).join(".")}: ${error.message}`).join("\n")
  );
}

async function fetchArticles(): Promise<ArticleNode[]> {
  const articles: ArticleNode[] = [];
  let after: string | null = null;

  do {
    const data: ArticlesResponse = await shopifyFetch<ArticlesResponse>(
      `query Articles($after: String) {
        articles(first: 250, after: $after, sortKey: PUBLISHED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              handle
              title
              tags
              blog { handle title }
              image { url altText }
            }
          }
        }
      }`,
      { after }
    );

    articles.push(...data.articles.edges.map((edge: { node: ArticleNode }) => edge.node));
    after = data.articles.pageInfo.hasNextPage ? data.articles.pageInfo.endCursor : null;
  } while (after);

  return articles;
}

async function updateArticleImage(article: ArticleNode, image: { url: string; altText: string }) {
  const res = await shopifyFetch<ArticleUpdateResponse>(
    `mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id handle image { url altText } }
        userErrors { field message }
      }
    }`,
    { id: article.id, article: { image } }
  );

  assertNoUserErrors(`articleUpdate ${article.handle}`, res.articleUpdate.userErrors);
  if (!res.articleUpdate.article) throw new Error(`articleUpdate ${article.handle} returned no article`);
  return res.articleUpdate.article;
}

async function main() {
  log("\n" + "=".repeat(72));
  log(`${APPLY ? "APPLY" : "DRY-RUN"} - backfill Shopify article featured images`);
  log("=".repeat(72));
  log(`Blog: ${BLOG_HANDLE}`);
  log(`Force existing images: ${FORCE ? "yes" : "no"}`);
  log(`Fallback image allowed: ${INCLUDE_FALLBACK ? "yes" : "no"}`);
  if (HANDLE_FILTER.size) log(`Handles: ${Array.from(HANDLE_FILTER).join(", ")}`);
  log("");

  const allArticles = await fetchArticles();
  const candidates = allArticles.filter((article) => {
    if (article.blog?.handle !== BLOG_HANDLE) return false;
    if (HANDLE_FILTER.size && !HANDLE_FILTER.has(article.handle)) return false;
    return true;
  });

  const rows: Array<{ handle: string; status: string }> = [];

  for (const article of candidates) {
    if (article.image && !FORCE) {
      log(`SKIP existing image  ${article.handle}`);
      rows.push({ handle: article.handle, status: "existing image" });
      continue;
    }

    const image = getArticleFeaturedImage(
      {
        handle: article.handle,
        title: article.title,
        tags: article.tags,
        blogHandle: article.blog?.handle,
      },
      { includeFallback: INCLUDE_FALLBACK }
    );

    if (!image) {
      log(`SKIP no image match  ${article.handle}`);
      rows.push({ handle: article.handle, status: "no image match" });
      continue;
    }

    log(`${APPLY ? "SET " : "WOULD SET"} ${article.handle}`);
    log(`  title: ${article.title}`);
    log(`  image: ${image.url}`);
    log(`  alt:   ${image.altText}`);

    if (APPLY) {
      const updated = await updateArticleImage(article, image);
      log(`  updated: ${updated.image?.url ?? "(no image returned)"}`);
      rows.push({ handle: article.handle, status: "updated" });
    } else {
      rows.push({ handle: article.handle, status: "would update" });
    }
  }

  log("\n--- Summary ---");
  for (const row of rows) log(`[${row.status}] ${row.handle}`);
  if (!APPLY) log("\nDry run only. Re-run with APPLY=1 to mutate Shopify.");
}

main().catch((err) => {

  console.error(err);
  process.exit(1);
});
