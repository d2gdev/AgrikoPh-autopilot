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
        media: {
          edges: Array<{
            node: { id?: string; alt?: string | null; image?: { url: string } | null };
          }>;
        };
      };
    }>;
  };
};

// Queries `media` rather than the deprecated `images` connection so imageId is a
// MediaImage GID — the only ID type productUpdateMedia/fileUpdate accept for alt-text writes.
export async function fetchProductImages(): Promise<ProductImage[]> {
  const query = `
    query ProductMediaImages($after: String) {
      products(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            media(first: 250) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    alt
                    image {
                      url
                    }
                  }
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
      for (const { node: media } of product.media.edges) {
        // Non-image media surface as empty objects from the inline fragment;
        // images still processing have no url yet — skip both.
        if (!media.id || !media.image?.url) continue;
        images.push({
          imageId: media.id,
          productId: product.id,
          productTitle: product.title,
          imageUrl: media.image.url,
          altText: media.alt?.trim() ? media.alt : null,
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

export async function updateProductMediaAlt(
  productId: string,
  mediaId: string,
  alt: string
): Promise<{ id: string; alt: string | null }> {
  const mutation = `
    mutation UpdateImageAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media {
          id
          alt
        }
        mediaUserErrors {
          field
          message
        }
      }
    }
  `;
  const data = await shopifyFetch<{
    productUpdateMedia: {
      media: Array<{ id: string; alt: string | null }> | null;
      mediaUserErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(mutation, { productId, media: [{ id: mediaId, alt }] });

  const errors = data.productUpdateMedia.mediaUserErrors;
  if (errors?.length) throw new Error(errors[0]!.message);
  const media = data.productUpdateMedia.media?.[0];
  if (!media) throw new Error("Shopify returned no media in productUpdateMedia response");
  return media;
}

export async function updateProductSeo(
  productId: string,
  seo: { title?: string; description?: string },
  content: { title?: string; descriptionHtml?: string } = {}
): Promise<{ id: string; seo: { title: string | null; description: string | null } }> {
  validateGovernedFields(seo.title, seo.description, content.descriptionHtml);
  const mutation = `
    mutation UpdateProductSeo($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          seo {
            title
            description
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const data = await shopifyFetch<{
    productUpdate: {
      product: { id: string; seo: { title: string | null; description: string | null } } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(mutation, { product: { id: productId, seo, ...content } });

  const errors = data.productUpdate.userErrors;
  if (errors?.length) throw new Error(errors[0]!.message);
  const product = data.productUpdate.product;
  if (!product) throw new Error("Shopify returned no product in productUpdate response");
  return product;
}

function validateGovernedFields(title?: string, description?: string, html?: string): void {
  if (title !== undefined && title.length > 70) throw new Error("SEO title must be 70 characters or fewer");
  if (description !== undefined && description.length > 160) throw new Error("SEO description must be 160 characters or fewer");
  if (html !== undefined && html.length > 50_000) throw new Error("HTML must be 50,000 characters or fewer");
}

export async function updateCollectionSeoAndBody(
  collectionId: string,
  seo: { title?: string; description?: string },
  content: { title?: string; descriptionHtml?: string } = {}
): Promise<{ id: string; seo: { title: string | null; description: string | null } }> {
  validateGovernedFields(seo.title, seo.description, content.descriptionHtml);
  const data = await shopifyFetch<{ collectionUpdate: { collection: { id: string; seo: { title: string | null; description: string | null } } | null; userErrors: Array<{ message: string }> } }>(`
    mutation UpdateCollectionSeoAndBody($input: CollectionInput!) {
      collectionUpdate(input: $input) { collection { id seo { title description } } userErrors { field message } }
    }
  `, { input: { id: collectionId, seo, ...content } });
  if (data.collectionUpdate.userErrors?.length) throw new Error(data.collectionUpdate.userErrors[0]!.message);
  if (!data.collectionUpdate.collection) throw new Error("Shopify returned no collection in collectionUpdate response");
  return data.collectionUpdate.collection;
}

export async function updatePageSeoAndBody(
  pageId: string,
  change: { title?: string; seoTitle?: string; seoDescription?: string; bodyHtml?: string }
): Promise<{ id: string }> {
  validateGovernedFields(change.seoTitle, change.seoDescription, change.bodyHtml);
  const metafields = [
    change.seoTitle === undefined ? null : { namespace: "global", key: "title_tag", type: "single_line_text_field", value: change.seoTitle },
    change.seoDescription === undefined ? null : { namespace: "global", key: "description_tag", type: "single_line_text_field", value: change.seoDescription },
  ].filter((value): value is NonNullable<typeof value> => value !== null);
  const page = {
    id: pageId,
    ...(change.title === undefined ? {} : { title: change.title }),
    ...(change.bodyHtml === undefined ? {} : { body: change.bodyHtml }),
    ...(metafields.length ? { metafields } : {}),
  };
  const data = await shopifyFetch<{ pageUpdate: { page: { id: string } | null; userErrors: Array<{ message: string }> } }>(`
    mutation UpdatePageSeoAndBody($page: PageUpdateInput!) {
      pageUpdate(page: $page) { page { id } userErrors { field message } }
    }
  `, { page });
  if (data.pageUpdate.userErrors?.length) throw new Error(data.pageUpdate.userErrors[0]!.message);
  if (!data.pageUpdate.page) throw new Error("Shopify returned no page in pageUpdate response");
  return data.pageUpdate.page;
}

export interface CatalogProductVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
}

export interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  variants: CatalogProductVariant[];
}

type ProductCatalogResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        title: string;
        handle: string;
        variants: {
          edges: Array<{
            node: { id: string; title: string; price: string; compareAtPrice: string | null };
          }>;
        };
      };
    }>;
  };
};

export async function fetchCatalogProducts(): Promise<CatalogProduct[]> {
  const query = `
    query CatalogProducts($after: String) {
      products(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      }
    }
  `;

  const products: CatalogProduct[] = [];
  let after: string | null = null;
  let page = 0;
  const MAX_PAGES = 50;
  do {
    const data: ProductCatalogResponse = await shopifyFetch<ProductCatalogResponse>(query, { after });

    products.push(...data.products.edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      variants: node.variants.edges.map(({ node: variant }) => ({
        id: variant.id,
        title: variant.title,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
      })),
    })));
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    if (++page >= MAX_PAGES && after) {
      console.warn(`[shopify-admin] fetchCatalogProducts truncated at ${MAX_PAGES} pages`);
      break;
    }
  } while (after);

  return products;
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
