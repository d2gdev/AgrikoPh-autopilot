import { createHash } from "node:crypto";
import { parseArticleHtml } from "@/lib/analyzers/html-parser";
import { shopifyFetch, updateCollectionSeoAndBody, updatePageSeoAndBody, updateProductSeo } from "@/lib/shopify-admin";
import { normalizeGovernedUrl } from "@/lib/topical-map/url-normalizer";

export type GovernedStoreTargetType = "product" | "collection" | "page";

export interface GovernedStoreResource {
  id: string;
  type: GovernedStoreTargetType;
  url: string;
  handle: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  bodyHtml: string;
  capturedAt: Date;
  updatedAt: Date;
  stateHash: string;
  internalTargets: string[];
}

export type GovernedStoreResourceChange = Partial<Pick<GovernedStoreResource, "seoTitle" | "seoDescription" | "title" | "bodyHtml">>;

export interface GovernedRedirect {
  id: string;
  source: string;
  target: string;
  capturedAt: Date;
  stateHash: string;
}

function governedPath(value: string): string {
  const normalized = normalizeGovernedUrl(value);
  if (normalized.startsWith("/")) return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  const parsed = new URL(normalized);
  return `${parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function resolveGovernedStoreUrl(value: string): { type: GovernedStoreTargetType; handle: string } | null {
  let normalized: string;
  try { normalized = normalizeGovernedUrl(value); } catch { return null; }
  const pathname = normalized.startsWith("/") ? new URL(normalized, "https://agrikoph.com").pathname : new URL(normalized).pathname;
  const match = pathname.match(/^\/(products|collections|pages)\/([^/]+)$/);
  if (!match) return null;
  const types = { products: "product", collections: "collection", pages: "page" } as const;
  try {
    return { type: types[match[1] as keyof typeof types], handle: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

type Node = { id: string; handle: string; title: string; updatedAt: string; descriptionHtml?: string; body?: string; seo?: { title?: string | null; description?: string | null }; seoTitle?: { value: string | null } | null; seoDescription?: { value: string | null } | null };
type Connection = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: Node }> };

const queries = {
  product: `query GovernedProducts($after: String) { products(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { node { id handle title descriptionHtml updatedAt seo { title description } } } } }`,
  collection: `query GovernedCollections($after: String) { collections(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { node { id handle title descriptionHtml updatedAt seo { title description } } } } }`,
  page: `query GovernedPages($after: String) { pages(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { node { id handle title body updatedAt seoTitle: metafield(namespace: "global", key: "title_tag") { value } seoDescription: metafield(namespace: "global", key: "description_tag") { value } } } } }`,
} as const;

function resource(type: GovernedStoreTargetType, node: Node): GovernedStoreResource {
  const plural = type === "product" ? "products" : type === "collection" ? "collections" : "pages";
  const url = `/${plural}/${node.handle}`;
  const bodyHtml = node.descriptionHtml ?? node.body ?? "";
  const updatedAt = new Date(node.updatedAt);
  if (!Number.isFinite(updatedAt.getTime()) || updatedAt.getTime() > Date.now() + 5 * 60_000) {
    throw new Error("Invalid Shopify resource observation timestamp");
  }
  const seoTitle = type === "page" ? node.seoTitle?.value ?? null : node.seo?.title ?? null;
  const seoDescription = type === "page" ? node.seoDescription?.value ?? null : node.seo?.description ?? null;
  const canonical = JSON.stringify({ id: node.id, type, url, title: node.title, seoTitle, seoDescription, bodyHtml, updatedAt: updatedAt.toISOString() });
  const internalTargets = parseArticleHtml(bodyHtml).anchors.flatMap(({ href }) => {
    try {
      const normalized = normalizeGovernedUrl(href);
      if (normalized.startsWith("/")) return [normalized];
      const parsed = new URL(normalized);
      return [`${parsed.pathname}${parsed.search}${parsed.hash}`];
    } catch { return []; }
  });
  return { id: node.id, type, url, handle: node.handle, title: node.title, seoTitle, seoDescription, bodyHtml, capturedAt: new Date(), updatedAt, stateHash: createHash("sha256").update(canonical).digest("hex"), internalTargets };
}

export async function fetchGovernedStoreResources(urls: string[]): Promise<Map<string, GovernedStoreResource>> {
  const requested = new Set(urls.map((url) => resolveGovernedStoreUrl(url)).filter((value): value is NonNullable<typeof value> => value !== null).map(({ type, handle }) => `${type}:${handle}`));
  const result = new Map<string, GovernedStoreResource>();
  for (const type of ["product", "collection", "page"] as const) {
    if (![...requested].some((key) => key.startsWith(`${type}:`))) continue;
    let after: string | null = null;
    do {
      const key = type === "product" ? "products" : type === "collection" ? "collections" : "pages";
      const data: Record<string, Connection> = await shopifyFetch<Record<string, Connection>>(queries[type], { after });
      const connection = data[key]!;
      for (const { node } of connection.edges) {
        if (!node.handle || !requested.has(`${type}:${node.handle}`)) continue;
        const item = resource(type, node);
        result.set(item.url, item);
      }
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
  }
  return result;
}

export async function fetchGovernedStoreResource(url: string): Promise<GovernedStoreResource | null> {
  const resolved = resolveGovernedStoreUrl(url);
  if (!resolved) return null;
  const canonical = `/${resolved.type === "product" ? "products" : resolved.type === "collection" ? "collections" : "pages"}/${resolved.handle}`;
  return (await fetchGovernedStoreResources([canonical])).get(canonical) ?? null;
}

export async function fetchGovernedRedirects(sources: string[]): Promise<Map<string, GovernedRedirect>> {
  const requested = new Set(sources.map(governedPath));
  const result = new Map<string, GovernedRedirect>();
  let after: string | null = null;
  do {
    const data: { urlRedirects: Connection & { edges: Array<{ node: { id: string; path: string; target: string } }> } } = await shopifyFetch(`
      query GovernedUrlRedirects($after: String) {
        urlRedirects(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges { node { id path target } }
        }
      }
    `, { after });
    for (const { node } of data.urlRedirects.edges) {
      const source = governedPath(node.path);
      if (!requested.has(source)) continue;
      const target = governedPath(node.target);
      const capturedAt = new Date();
      result.set(source, { id: node.id, source, target, capturedAt, stateHash: createHash("sha256").update(JSON.stringify({ id: node.id, source, target })).digest("hex") });
    }
    after = data.urlRedirects.pageInfo.hasNextPage ? data.urlRedirects.pageInfo.endCursor : null;
  } while (after);
  return result;
}

export async function createGovernedRedirect(sourceValue: string, targetValue: string): Promise<GovernedRedirect> {
  const source = governedPath(sourceValue);
  const target = governedPath(targetValue);
  const data = await shopifyFetch<{ urlRedirectCreate: { urlRedirect: { id: string; path: string; target: string } | null; userErrors: Array<{ field?: string[]; message: string }> } }>(`
    mutation CreateGovernedUrlRedirect($urlRedirect: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $urlRedirect) {
        urlRedirect { id path target }
        userErrors { field message }
      }
    }
  `, { urlRedirect: { path: source, target } });
  const error = data.urlRedirectCreate.userErrors[0];
  if (error) throw new Error(error.message);
  const created = data.urlRedirectCreate.urlRedirect;
  if (!created) throw new Error("Shopify did not return the created redirect");
  const createdSource = governedPath(created.path);
  const createdTarget = governedPath(created.target);
  if (createdSource !== source || createdTarget !== target) throw new Error("Shopify returned a different redirect than requested");
  return { id: created.id, source, target, capturedAt: new Date(), stateHash: createHash("sha256").update(JSON.stringify({ id: created.id, source, target })).digest("hex") };
}

export async function applyGovernedStoreResourceChange(resource: GovernedStoreResource, proposed: GovernedStoreResourceChange): Promise<GovernedStoreResource> {
  const allowed = new Set(["seoTitle", "seoDescription", "title", "bodyHtml"]);
  for (const key of Object.keys(proposed)) if (!allowed.has(key)) throw new Error(`Governed resource change key is not allowed: ${key}`);
  switch (resource.type) {
    case "product":
      if (proposed.title !== undefined) throw new Error("title is not allowed for product resources");
      await updateProductSeo(resource.id, { ...(proposed.seoTitle === undefined ? {} : { title: proposed.seoTitle ?? "" }), ...(proposed.seoDescription === undefined ? {} : { description: proposed.seoDescription ?? "" }) }, { ...(proposed.bodyHtml === undefined ? {} : { descriptionHtml: proposed.bodyHtml }) });
      break;
    case "collection":
      if (proposed.title !== undefined) throw new Error("title is not allowed for collection resources");
      await updateCollectionSeoAndBody(resource.id, { ...(proposed.seoTitle === undefined ? {} : { title: proposed.seoTitle ?? "" }), ...(proposed.seoDescription === undefined ? {} : { description: proposed.seoDescription ?? "" }) }, { ...(proposed.bodyHtml === undefined ? {} : { descriptionHtml: proposed.bodyHtml }) });
      break;
    case "page":
      await updatePageSeoAndBody(resource.id, {
        ...(proposed.title === undefined ? {} : { title: proposed.title }),
        ...(proposed.seoTitle === undefined ? {} : { seoTitle: proposed.seoTitle ?? "" }),
        ...(proposed.seoDescription === undefined ? {} : { seoDescription: proposed.seoDescription ?? "" }),
        ...(proposed.bodyHtml === undefined ? {} : { bodyHtml: proposed.bodyHtml }),
      });
      break;
    default:
      throw new Error(`Unsupported governed store resource type: ${String(resource.type)}`);
  }
  const updated = await fetchGovernedStoreResource(resource.url);
  if (!updated) throw new Error("Shopify did not return updated governed resource after mutation");
  return updated;
}
