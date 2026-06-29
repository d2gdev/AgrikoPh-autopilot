import { getOptionalSecret } from "@/lib/config/resolver";

export interface ShoppingKeywordInput {
  keyword: string;
  locationName?: string | null;
  languageCode?: string | null;
}

export interface ShoppingProductResult {
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

interface ShoppingFetchResult {
  disabled?: boolean;
  pending?: boolean;
  products: ShoppingProductResult[];
  taskId?: string;
}

const TASK_POST_URL = "https://api.dataforseo.com/v3/merchant/google/products/task_post";
const TASK_GET_URL = "https://api.dataforseo.com/v3/merchant/google/products/task_get/advanced";

export function isDataForSeoConfigured() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

async function authHeader() {
  const login = await getOptionalSecret("DATAFORSEO_LOGIN") ?? "";
  const password = await getOptionalSecret("DATAFORSEO_PASSWORD") ?? "";
  if (!login || !password) return null;
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}

function normalizeProduct(item: unknown, index: number): ShoppingProductResult | null {
  const record = asRecord(item);
  const price = asRecord(record.price);
  const rating = asRecord(record.rating);
  const title = pickString(record, ["title", "name"]);
  if (!title) return null;

  return {
    title,
    brand: pickString(record, ["brand", "manufacturer"]),
    price: asNumber(price.current) ?? asNumber(record.price) ?? asNumber(record.price_from),
    currency: pickString(price, ["currency"]) ?? pickString(record, ["currency"]),
    store: pickString(record, ["seller", "store", "domain", "source"]),
    rating: asNumber(rating.value) ?? asNumber(record.rating),
    reviewCount: asNumber(rating.votes_count) ?? asNumber(record.reviews_count) ?? asNumber(record.review_count),
    searchPosition: asNumber(record.rank_absolute) ?? asNumber(record.rank_group) ?? index + 1,
    productUrl: pickString(record, ["url", "product_url"]),
    imageUrl: pickString(record, ["image_url", "main_image"]),
    rawPayload: record,
  };
}

function extractTaskId(payload: Record<string, unknown>): string | undefined {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const firstTask = asRecord(tasks[0]);
  return asString(firstTask.id) ?? undefined;
}

function extractProducts(payload: Record<string, unknown>): ShoppingProductResult[] {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const products: ShoppingProductResult[] = [];
  for (const task of tasks) {
    const results = Array.isArray(asRecord(task).result) ? asRecord(task).result as unknown[] : [];
    for (const result of results) {
      const items = Array.isArray(asRecord(result).items) ? asRecord(result).items as unknown[] : [];
      items.forEach((item, index) => {
        const normalized = normalizeProduct(item, index);
        if (normalized) products.push(normalized);
      });
    }
  }
  return products;
}

async function dataForSeoFetch(url: string, init: RequestInit) {
  const auth = await authHeader();
  if (!auth) return null;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!res.ok) {
    throw new Error(`DataForSEO error ${res.status}: ${String(payload.status_message ?? text).slice(0, 500)}`);
  }
  return payload;
}

export async function fetchShoppingProducts(input: ShoppingKeywordInput): Promise<ShoppingFetchResult> {
  const taskPayload = [{
    keyword: input.keyword,
    location_name: input.locationName ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
    language_code: input.languageCode ?? "en",
    priority: 1,
  }];

  const posted = await dataForSeoFetch(TASK_POST_URL, {
    method: "POST",
    body: JSON.stringify(taskPayload),
  });
  if (!posted) return { disabled: true, products: [] };
  const taskId = extractTaskId(posted);
  if (!taskId) return { pending: true, products: [] };

  const result = await dataForSeoFetch(`${TASK_GET_URL}/${taskId}`, { method: "GET" });
  if (!result) return { disabled: true, products: [] };
  const products = extractProducts(result);
  return { pending: products.length === 0, products, taskId };
}
