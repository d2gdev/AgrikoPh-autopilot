import { getOptionalSecret } from "@/lib/config/resolver";
import { envInt } from "@/lib/market-intel/profiles";

export interface RankedKeywordResult {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  cpc: number | null;
  url: string | null;
}

export interface DomainIntersectionResult {
  keyword: string;
  competitorPosition: number | null;
  ourPosition: number | null;
  searchVolume: number | null;
  cpc: number | null;
}

interface LabsFetchResult<T> {
  disabled?: boolean;
  items: T[];
}

const RANKED_KEYWORDS_URL = "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
const DOMAIN_INTERSECTION_URL = "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function isDataForSeoLabsConfigured() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

// Clamps a caller-supplied or env-configured limit to (1, MAX_LIMIT], falling
// back to DEFAULT_LIMIT for anything non-finite or <= 0. This is a metered API
// — never let a misconfigured/huge value pass through to the live request.
export function resolveLabsLimit(raw: number | undefined): number {
  const value = raw ?? envInt(process.env.DATAFORSEO_LABS_LIMIT, DEFAULT_LIMIT);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.round(value), MAX_LIMIT);
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

async function dataForSeoLabsFetch(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  const auth = await authHeader();
  if (!auth) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!res.ok) {
    throw new Error(`DataForSEO error ${res.status}: ${String(payload.status_message ?? text).slice(0, 500)}`);
  }
  return payload;
}

// Both live endpoints return { tasks: [{ result: [{ items: [...] }] }] } —
// mirrors the unwrapping in lib/connectors/dataforseo-shopping.ts.
function extractItems(payload: Record<string, unknown>): unknown[] {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const items: unknown[] = [];
  for (const task of tasks) {
    const results = Array.isArray(asRecord(task).result) ? asRecord(task).result as unknown[] : [];
    for (const result of results) {
      const resultItems = Array.isArray(asRecord(result).items) ? asRecord(result).items as unknown[] : [];
      items.push(...resultItems);
    }
  }
  return items;
}

function normalizeRankedKeyword(item: unknown): RankedKeywordResult | null {
  const record = asRecord(item);
  const keywordData = asRecord(record.keyword_data);
  const keywordInfo = asRecord(keywordData.keyword_info);
  const rankedElement = asRecord(record.ranked_serp_element);
  const serpItem = asRecord(rankedElement.serp_item);

  const keyword = asString(keywordData.keyword) ?? asString(record.keyword);
  if (!keyword) return null;

  return {
    keyword,
    position: asNumber(serpItem.rank_absolute) ?? asNumber(serpItem.rank_group),
    searchVolume: asNumber(keywordInfo.search_volume),
    cpc: asNumber(keywordInfo.cpc),
    url: asString(serpItem.url),
  };
}

function normalizeIntersectionItem(item: unknown): DomainIntersectionResult | null {
  const record = asRecord(item);
  const keywordData = asRecord(record.keyword_data);
  const keywordInfo = asRecord(keywordData.keyword_info);
  // Domain intersection items carry first/second domain SERP elements —
  // "first" is the first domain passed in the request, "second" the competitor.
  const firstElement = asRecord(record.first_domain_serp_element);
  const secondElement = asRecord(record.second_domain_serp_element);

  const keyword = asString(keywordData.keyword) ?? asString(record.keyword);
  if (!keyword) return null;

  return {
    keyword,
    ourPosition: asNumber(firstElement.rank_absolute) ?? asNumber(firstElement.rank_group),
    competitorPosition: asNumber(secondElement.rank_absolute) ?? asNumber(secondElement.rank_group),
    searchVolume: asNumber(keywordInfo.search_volume),
    cpc: asNumber(keywordInfo.cpc),
  };
}

export async function fetchRankedKeywords(domain: string, limit?: number): Promise<LabsFetchResult<RankedKeywordResult>> {
  const resolvedLimit = resolveLabsLimit(limit);
  const taskPayload = [{
    target: domain,
    language_code: "en",
    // Labs-only location override — lets Labs calls target a different Google
    // database than shopping/keyword research if ever needed.
    location_name: process.env.DATAFORSEO_LABS_LOCATION ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
    limit: resolvedLimit,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  }];

  const payload = await dataForSeoLabsFetch(RANKED_KEYWORDS_URL, taskPayload);
  if (!payload) return { disabled: true, items: [] };

  const items: RankedKeywordResult[] = [];
  for (const raw of extractItems(payload)) {
    const normalized = normalizeRankedKeyword(raw);
    if (normalized) items.push(normalized);
  }
  return { items: items.slice(0, resolvedLimit) };
}

export async function fetchDomainIntersection(
  ourDomain: string,
  competitorDomain: string,
  limit?: number,
): Promise<LabsFetchResult<DomainIntersectionResult>> {
  const resolvedLimit = resolveLabsLimit(limit);
  const taskPayload = [{
    target1: ourDomain,
    target2: competitorDomain,
    language_code: "en",
    // Labs-only location override — lets Labs calls target a different Google
    // database than shopping/keyword research if ever needed.
    location_name: process.env.DATAFORSEO_LABS_LOCATION ?? process.env.MARKET_INTEL_DEFAULT_LOCATION ?? "Philippines",
    limit: resolvedLimit,
    // `intersections: true` (the API default) returns only keywords BOTH
    // domains rank for — useless for gap-finding. We want the union (keywords
    // either domain ranks for) so we can filter client-side, below the
    // caller's control, for "competitor ranks, we don't" — hence false here.
    intersections: false,
  }];

  const payload = await dataForSeoLabsFetch(DOMAIN_INTERSECTION_URL, taskPayload);
  if (!payload) return { disabled: true, items: [] };

  const items: DomainIntersectionResult[] = [];
  for (const raw of extractItems(payload)) {
    const normalized = normalizeIntersectionItem(raw);
    // Keep only rows where the competitor ranks and we don't — the actual
    // "gap" signal callers care about.
    if (normalized && normalized.competitorPosition != null && normalized.ourPosition == null) {
      items.push(normalized);
    }
  }
  return { items: items.slice(0, resolvedLimit) };
}
