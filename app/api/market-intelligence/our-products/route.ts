import { NextResponse } from "next/server";
import { requireAppAuth } from "@/lib/auth";
import { shopifyFetch } from "@/lib/shopify-admin";

interface ProductNode {
  id: string;
  title: string;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
}

interface ProductsResponse {
  products: {
    edges: { node: ProductNode }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

type ProductsPayload = {
  products: { id: string; title: string; price: number; currency: string }[];
  cachedAt: string;
  cacheTtlMs: number;
};

const PRODUCTS_CACHE_TTL_MS = 60_000;

let productsCache: { expiresAt: number; payload: ProductsPayload } | null = null;
let productsInFlight: Promise<ProductsPayload> | null = null;

const QUERY = `
  query OurProducts($after: String) {
    products(first: 100, after: $after) {
      edges {
        node {
          id
          title
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function loadProductsPayload(forceRefresh: boolean): Promise<ProductsPayload> {
  const now = Date.now();
  if (!forceRefresh && productsCache && productsCache.expiresAt > now) {
    return productsCache.payload;
  }
  if (!forceRefresh && productsInFlight) return productsInFlight;

  const request = (async () => {
    const products: ProductsPayload["products"] = [];
    let after: string | null = null;

    for (let page = 0; page < 10; page++) {
      const data: ProductsResponse = await shopifyFetch<ProductsResponse>(QUERY, after ? { after } : {});
      for (const { node } of data.products.edges) {
        const min = node.priceRangeV2.minVariantPrice;
        products.push({
          id: node.id,
          title: node.title,
          price: parseFloat(min.amount),
          currency: min.currencyCode,
        });
      }
      if (!data.products.pageInfo.hasNextPage) break;
      after = data.products.pageInfo.endCursor;
    }

    const payload: ProductsPayload = {
      products,
      cachedAt: new Date().toISOString(),
      cacheTtlMs: PRODUCTS_CACHE_TTL_MS,
    };
    productsCache = { expiresAt: Date.now() + PRODUCTS_CACHE_TTL_MS, payload };
    return payload;
  })();

  productsInFlight = request;
  try {
    return await request;
  } finally {
    if (productsInFlight === request) productsInFlight = null;
  }
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await loadProductsPayload(forceRefresh));
  } catch (err) {
    console.error("[our-products] Shopify fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch products from Shopify" }, { status: 500 });
  }
}
