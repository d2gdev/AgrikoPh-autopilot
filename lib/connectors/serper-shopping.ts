import { getOptionalSecret } from "@/lib/config/resolver";

export interface SerperShoppingInput {
  keyword: string;
  countryCode?: string | null;
  languageCode?: string | null;
  limit?: number;
  /** 1-based results page. Google Shopping returns ~40 results/page regardless of `num`; paginate for more depth. */
  page?: number;
}

export interface SerperShoppingProduct {
  title: string;
  brand?: string | null;
  price?: number | null;
  currency?: string | null;
  store?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  searchPosition?: number | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  rawPayload: Record<string, unknown>;
}

interface SerperShoppingResult {
  disabled?: boolean;
  products: SerperShoppingProduct[];
}

const SHOPPING_URL = "https://google.serper.dev/shopping";

async function getSerperApiKey() {
  return await getOptionalSecret("SERPER_API_KEY")
    ?? await getOptionalSecret("SERPER_DEV_API_KEY")
    ?? await getOptionalSecret("SERPER_KEY")
    ?? await getOptionalSecret("GOOGLE_SERPER_API_KEY")
    ?? "";
}

export async function isSerperConfigured() {
  return Boolean(await getSerperApiKey());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePrice(value: unknown): { price: number | null; currency: string | null } {
  const text = asString(value);
  if (!text) return { price: null, currency: null };
  const price = asNumber(text);
  const currencyMatch = text.match(/[A-Z]{3}|[$€£₱¥]/);
  return { price, currency: currencyMatch?.[0] ?? null };
}

function normalizeProduct(item: unknown, index: number): SerperShoppingProduct | null {
  const record = asRecord(item);
  const title = asString(record.title);
  if (!title) return null;

  const parsedPrice = parsePrice(record.price);

  return {
    title,
    brand: asString(record.brand),
    price: asNumber(record.extractedPrice) ?? parsedPrice.price,
    currency: asString(record.currency) ?? parsedPrice.currency,
    store: asString(record.source) ?? asString(record.seller),
    rating: asNumber(record.rating),
    reviewCount: asNumber(record.ratingCount) ?? asNumber(record.reviews),
    searchPosition: asNumber(record.position) ?? index + 1,
    productUrl: asString(record.link) ?? asString(record.productLink),
    imageUrl: asString(record.imageUrl) ?? asString(record.thumbnailUrl),
    rawPayload: record,
  };
}

export async function fetchSerperShoppingProducts(input: SerperShoppingInput): Promise<SerperShoppingResult> {
  const apiKey = await getSerperApiKey();
  if (!apiKey) return { disabled: true, products: [] };

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const res = await fetch(SHOPPING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q: input.keyword,
      gl: input.countryCode ?? process.env.MARKET_INTEL_DEFAULT_COUNTRY ?? "ph",
      hl: input.languageCode ?? "en",
      num: limit,
      ...(input.page && input.page > 1 ? { page: input.page } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!res.ok) {
    // Quota exhaustion (403 "Not enough credits"), bad key (401), payment
    // required (402) and rate-limit (429) are the expected degradation path —
    // return `disabled` so the caller falls back to DataForSEO and marks the
    // source degraded, instead of throwing once per keyword/competitor and
    // silently skipping the whole graceful-degradation design.
    if ([401, 402, 403, 429].includes(res.status)) {
      return { disabled: true, products: [] };
    }
    throw new Error(`Serper Shopping error ${res.status}: ${String(payload.message ?? text).slice(0, 500)}`);
  }

  const shopping = Array.isArray(payload.shopping) ? payload.shopping : [];
  return {
    products: shopping
      .slice(0, limit)
      .map(normalizeProduct)
      .filter((product): product is SerperShoppingProduct => product != null),
  };
}
