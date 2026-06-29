import { getOptionalSecret } from "@/lib/config/resolver";

export interface MetaAdLibraryInput {
  pageId?: string | null;
  pageName: string;
  searchTerms?: string | null;
  country?: string | null;
  limit?: number;
}

export interface MetaAdLibraryAd {
  adArchiveId: string;
  pageName?: string | null;
  pageId?: string | null;
  adCopy?: string | null;
  headline?: string | null;
  description?: string | null;
  cta?: string | null;
  landingPageUrl?: string | null;
  adSnapshotUrl?: string | null;
  platforms?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  activeStatus?: string | null;
  creativeType?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  rawPayload: Record<string, unknown>;
}

interface MetaAdLibraryResult {
  disabled?: boolean;
  source?: "api" | "playwright";
  ads: MetaAdLibraryAd[];
}

const BASE_URL = "https://graph.facebook.com/v20.0/ads_archive";

export function isMetaAdLibraryConfigured() {
  return Boolean(process.env.META_AD_LIBRARY_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN);
}

async function token() {
  return await getOptionalSecret("META_AD_LIBRARY_ACCESS_TOKEN")
    ?? await getOptionalSecret("META_ACCESS_TOKEN")
    ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const stringValue = asString(item);
      if (stringValue) return stringValue;
    }
  }
  return asString(value);
}

function asDate(value: unknown): Date | null {
  const stringValue = asString(value);
  if (!stringValue) return null;
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeAd(item: unknown): MetaAdLibraryAd | null {
  const record = asRecord(item);
  const adArchiveId = asString(record.id);
  if (!adArchiveId) return null;

  const platforms = Array.isArray(record.publisher_platforms)
    ? record.publisher_platforms.filter((platform): platform is string => typeof platform === "string")
    : [];

  return {
    adArchiveId,
    pageName: asString(record.page_name),
    pageId: asString(record.page_id),
    adCopy: firstString(record.ad_creative_bodies),
    headline: firstString(record.ad_creative_link_titles),
    description: firstString(record.ad_creative_link_descriptions),
    cta: firstString(record.cta_text),
    landingPageUrl: firstString(record.ad_creative_link_captions),
    adSnapshotUrl: asString(record.ad_snapshot_url),
    platforms,
    startDate: asDate(record.ad_delivery_start_time ?? record.ad_creation_time),
    endDate: asDate(record.ad_delivery_stop_time),
    activeStatus: asString(record.ad_active_status),
    creativeType: asString(record.creative_type),
    imageUrl: firstString(record.images),
    videoUrl: firstString(record.videos),
    rawPayload: record,
  };
}

async function fetchPage(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!res.ok) {
    throw new Error(`Meta Ad Library error ${res.status}: ${String(asRecord(payload.error).message ?? text).slice(0, 500)}`);
  }
  return payload;
}

// The public ads_archive Graph API only returns political / social-issue ads
// outside the EU, so commercial competitor searches succeed with zero results.
// In that case (and on permission errors or a missing token) we fall back to the
// Playwright scraper, which is the real source of commercial ad intel for PH.
async function tryScraper(input: MetaAdLibraryInput): Promise<MetaAdLibraryResult> {
  try {
    const { scrapeMetaAdLibraryAds, isMetaAdLibraryScraperEnabled } = await import("./meta-ad-library-scraper");
    if (!isMetaAdLibraryScraperEnabled()) return { disabled: true, ads: [] };
    const scraped = await scrapeMetaAdLibraryAds(input, input.limit ?? 10);
    return { source: "playwright", ads: scraped.ads };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Cannot find module")) {
      return { disabled: true, ads: [] };
    }
    throw err;
  }
}

export async function fetchMetaAdLibraryAds(input: MetaAdLibraryInput): Promise<MetaAdLibraryResult> {
  const accessToken = await token();
  if (!accessToken) {
    return tryScraper(input);
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("ad_active_status", "ALL");
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("limit", "50");
  url.searchParams.set("ad_reached_countries", JSON.stringify([input.country ?? process.env.MARKET_INTEL_DEFAULT_COUNTRY ?? "PH"]));
  url.searchParams.set(
    "fields",
    [
      "id",
      "page_id",
      "page_name",
      "ad_creation_time",
      "ad_creative_bodies",
      "ad_creative_link_titles",
      "ad_creative_link_descriptions",
      "ad_creative_link_captions",
      "ad_snapshot_url",
      "publisher_platforms",
      "ad_delivery_start_time",
      "ad_delivery_stop_time",
      "ad_active_status",
    ].join(",")
  );

  if (input.pageId) {
    url.searchParams.set("search_page_ids", JSON.stringify([input.pageId]));
  } else {
    url.searchParams.set("search_terms", input.searchTerms ?? input.pageName);
  }

  const ads: MetaAdLibraryAd[] = [];
  let nextUrl: string | undefined = url.toString();
  let pagesFetched = 0;

  try {
    while (nextUrl && pagesFetched < 3 && ads.length < (input.limit ?? 50)) {
      const payload = await fetchPage(nextUrl);
      const data = Array.isArray(payload.data) ? payload.data : [];
      for (const item of data) {
        const ad = normalizeAd(item);
        if (ad) ads.push(ad);
        if (ads.length >= (input.limit ?? 50)) break;
      }
      nextUrl = asString(asRecord(payload.paging).next) ?? undefined;
      pagesFetched++;
    }
    // Commercial searches return 0 ads from the API outside the EU — fall back
    // to the scraper, which is the effective source for PH competitor ads.
    if (ads.length === 0) {
      const scraped = await tryScraper(input);
      if (scraped.ads.length > 0) return scraped;
    }
    return { source: "api", ads };
  } catch (err) {
    const message = String(err);
    if (!/permission|OAuthException|code.?10/i.test(message)) throw err;
    return tryScraper(input);
  }
}
