import { getSecret } from "@/lib/config/resolver";
import { refreshAndStoreShopifyToken } from "@/lib/connectors/shopify-token";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doShopifyFetch<T>(
  endpoint: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ res: Response; json: T | null }> {
  // Shopify GraphQL signals rate limiting two ways: HTTP 429, or HTTP 200 with
  // errors[].extensions.code === "THROTTLED". Retry ONLY those cases with
  // exponential backoff (1s/2s/4s). Any other error throws immediately.
  const MAX_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) return { res, json: null };

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Shopify GraphQL HTTP ${res.status}`);
    }

    if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors?.length) {
      const throttled = json.errors.some(
        (e: { extensions?: { code?: string } }) => e?.extensions?.code === "THROTTLED"
      );
      if (throttled && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(json.errors[0].message);
    }
    return { res, json: (json.data ?? null) as T | null };
  }
}

export async function shopifyFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const storeDomain = await getSecret("SHOPIFY_STORE_DOMAIN");
  const endpoint = `https://${storeDomain}/admin/api/2025-01/graphql.json`;
  let token = await getSecret("SHOPIFY_ADMIN_ACCESS_TOKEN");

  const { res, json } = await doShopifyFetch<T>(endpoint, token, query, variables);

  if (res.status === 401) {
    // Token expired — refresh, store in DB, retry once
    console.warn("[shopify-admin] 401 received, refreshing token...");
    token = await refreshAndStoreShopifyToken();
    const retry = await doShopifyFetch<T>(endpoint, token, query, variables);
    if (!retry.res.ok) throw new Error(`Shopify GraphQL HTTP ${retry.res.status} after token refresh`);
    if (retry.json == null) throw new Error("Shopify returned no data");
    return retry.json as T;
  }

  if (json == null) throw new Error("Shopify returned no data");
  return json as T;
}

export interface ProductImage {
  imageId: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  altText: string | null;
}

type ProductImagesResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        title: string;
        images: {
          edges: Array<{
            node: { id: string; url: string; altText: string | null };
          }>;
        };
      };
    }>;
  };
};

export async function fetchProductImages(): Promise<ProductImage[]> {
  const query = `
    query ProductImages($after: String) {
      products(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            images(first: 250) {
              edges {
                node {
                  id
                  url
                  altText
                }
              }
            }
          }
        }
      }
    }
  `;

  const images: ProductImage[] = [];
  let after: string | null = null;
  let page = 0;
  const MAX_PAGES = 50;
  do {
    const data: ProductImagesResponse = await shopifyFetch<ProductImagesResponse>(query, { after });

    for (const { node: product } of data.products.edges) {
      for (const { node: image } of product.images.edges) {
        images.push({
          imageId: image.id,
          productId: product.id,
          productTitle: product.title,
          imageUrl: image.url,
          altText: image.altText ?? null,
        });
      }
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    if (++page >= MAX_PAGES && after) {
      console.warn(`[shopify-admin] fetchProductImages truncated at ${MAX_PAGES} pages`);
      break;
    }
  } while (after);

  return images;
}

export interface BlogArticle {
  id: string;
  title: string;
  handle: string;
  blogTitle: string;
  blogHandle: string;
  publishedAt: string | null;
  authorName: string;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  bodySummary: string;
  bodyHtml: string;
  onlineStoreUrl: string | null;
}

type BlogArticlesResponse = {
  articles: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        title: string;
        handle: string;
        publishedAt: string | null;
        author: { name: string } | null;
        blog: { title: string; handle: string } | null;
        tags: string[];
        summary: string;
        body: string;
        seoTitle: { value: string | null } | null;
        seoDescription: { value: string | null } | null;
      };
    }>;
  };
};

export async function fetchBlogArticles(): Promise<BlogArticle[]> {
  const query = `
    query BlogArticles($after: String) {
      articles(first: 250, after: $after, sortKey: PUBLISHED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            publishedAt
            author { name }
            blog { title handle }
            tags
            summary
            body
            seoTitle: metafield(namespace: "global", key: "title_tag") { value }
            seoDescription: metafield(namespace: "global", key: "description_tag") { value }
          }
        }
      }
    }
  `;

  const articles: BlogArticle[] = [];
  let after: string | null = null;
  let page = 0;
  const MAX_PAGES = 50;
  do {
    const data: BlogArticlesResponse = await shopifyFetch<BlogArticlesResponse>(query, { after });

    articles.push(...data.articles.edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      blogTitle: node.blog?.title ?? "Blog",
      blogHandle: node.blog?.handle ?? "news",
      publishedAt: node.publishedAt,
      authorName: node.author?.name ?? "Agriko",
      tags: node.tags ?? [],
      seoTitle: node.seoTitle?.value ?? null,
      seoDescription: node.seoDescription?.value ?? null,
      bodySummary: node.summary,
      bodyHtml: node.body,
      onlineStoreUrl: null,
    })));
    after = data.articles.pageInfo.hasNextPage ? data.articles.pageInfo.endCursor : null;
    if (++page >= MAX_PAGES && after) {
      console.warn(`[shopify-admin] fetchBlogArticles truncated at ${MAX_PAGES} pages`);
      break;
    }
  } while (after);

  return articles;
}
