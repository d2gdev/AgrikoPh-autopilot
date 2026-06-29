import { getOptionalSecret } from "@/lib/config/resolver";
import type { MetaAdLibraryAd } from "./meta-ad-library";

// Apify "Facebook Ads Library Scraper" (curious_coder) — pay-per-event, runs on
// the free credit. Returns the structured creative fields (title/cta/link) that
// the in-house Playwright scraper cannot reach. Used as the primary Meta source
// for competitor pages targeted by numeric page_id.
const ACTOR_FALLBACK = "XtaWFhbtfxyzqrFmd"; // curious_coder/facebook-ads-library-scraper

async function apifyToken() {
  return (await getOptionalSecret("APIFY_API")) ?? (await getOptionalSecret("APIFY_TOKEN")) ?? "";
}

export async function isApifyMetaEnabled() {
  if (process.env.APIFY_META_ENABLED === "false") return false;
  return Boolean(await apifyToken());
}

function api(path: string, token: string) {
  return `https://api.apify.com/v2${path}${path.includes("?") ? "&" : "?"}token=${token}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function unixToDate(v: unknown): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pageLibraryUrl(pageId: string, country: string) {
  return (
    "https://www.facebook.com/ads/library/?active_status=all&ad_type=all" +
    `&country=${encodeURIComponent(country)}&view_all_page_id=${encodeURIComponent(pageId)}`
  );
}

// Maps one Apify dataset item to the in-house MetaAdLibraryAd shape so it flows
// through the same competitorAd upsert + insight logic in fetch-market-intel.
function mapApifyAd(item: Record<string, unknown>): MetaAdLibraryAd | null {
  const adArchiveId = asString(item.ad_archive_id) ?? asString(item.ad_id);
  if (!adArchiveId) return null;
  const snap = (item.snapshot && typeof item.snapshot === "object" ? item.snapshot : {}) as Record<string, unknown>;
  const body = (snap.body && typeof snap.body === "object" ? snap.body : {}) as Record<string, unknown>;
  const images = Array.isArray(snap.images) ? (snap.images as Record<string, unknown>[]) : [];
  const videos = Array.isArray(snap.videos) ? (snap.videos as Record<string, unknown>[]) : [];
  const platforms = Array.isArray(item.publisher_platform)
    ? (item.publisher_platform as unknown[]).filter((p): p is string => typeof p === "string").map((p) => p.toLowerCase())
    : [];

  return {
    adArchiveId,
    pageName: asString(item.page_name) ?? asString(snap.page_name),
    pageId: asString(item.page_id) ?? asString(snap.page_id),
    adCopy: asString(body.text) ?? asString(snap.caption),
    headline: asString(snap.title),
    description: asString(snap.link_description),
    cta: asString(snap.cta_text),
    landingPageUrl: asString(snap.link_url),
    adSnapshotUrl: asString(item.ad_library_url) ?? asString(item.url),
    platforms,
    startDate: unixToDate(item.start_date),
    endDate: unixToDate(item.end_date),
    activeStatus: item.is_active === true ? "ACTIVE" : item.is_active === false ? "INACTIVE" : null,
    creativeType: asString(snap.display_format),
    imageUrl: asString(images[0]?.original_image_url) ?? asString(images[0]?.resized_image_url),
    videoUrl: asString(videos[0]?.video_sd_url) ?? asString(videos[0]?.video_hd_url),
    // Keep rawPayload compact — the full snapshot (images/cards) is huge and the
    // useful text already lives in the columns above.
    rawPayload: {
      source: "apify",
      ad_archive_id: adArchiveId,
      spend: item.spend ?? null,
      reach_estimate: item.reach_estimate ?? null,
      currency: item.currency ?? null,
      categories: item.categories ?? null,
      total_active_time: item.total_active_time ?? null,
      display_format: snap.display_format ?? null,
    },
  };
}

interface ApifyMetaResult {
  disabled?: boolean;
  adsByPageId: Map<string, MetaAdLibraryAd[]>;
  total: number;
}

// Runs ONE batched actor run for all competitor page_ids and returns the ads
// grouped by page_id. Numeric page_ids only (view_all_page_id requires them).
export async function fetchApifyMetaAdsByPages(
  pageIds: string[],
  opts: { country?: string; perPage?: number } = {}
): Promise<ApifyMetaResult> {
  const token = await apifyToken();
  const ids = Array.from(new Set(pageIds.filter((id) => /^\d+$/.test(id))));
  const empty: ApifyMetaResult = { adsByPageId: new Map(), total: 0 };
  if (!token) return { ...empty, disabled: true };
  if (ids.length === 0) return empty;

  const actor = (await getOptionalSecret("APIFY_META_ACTOR_ID")) ?? ACTOR_FALLBACK;
  const country = opts.country ?? process.env.MARKET_INTEL_DEFAULT_COUNTRY ?? "PH";
  const perPage = Math.min(Math.max(opts.perPage ?? 50, 1), 200);

  const input = {
    urls: ids.map((id) => ({ url: pageLibraryUrl(id, country), method: "GET" })),
    scrapeAdDetails: true,
    count: ids.length * perPage,
    limitPerSource: perPage,
    scrapePageAds: { activeStatus: "all", sortBy: "impressions_desc", countryCode: country },
  };

  const startRes = await fetch(api(`/acts/${actor}/runs`, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  const start = await startRes.json() as { data?: { id?: string; defaultDatasetId?: string; status?: string } };
  if (!start.data?.id || !start.data.defaultDatasetId) {
    throw new Error(`Apify run failed to start: ${JSON.stringify(start).slice(0, 300)}`);
  }
  const runId = start.data.id;
  const datasetId = start.data.defaultDatasetId;

  let status = start.data.status ?? "RUNNING";
  const t0 = Date.now();
  while (["READY", "RUNNING"].includes(status)) {
    await sleep(8000);
    const r = await fetch(api(`/actor-runs/${runId}`, token), { signal: AbortSignal.timeout(30_000) });
    const j = await r.json() as { data?: { status?: string } };
    status = j.data?.status ?? "FAILED";
    if (Date.now() - t0 > 10 * 60 * 1000) break; // hard cap 10 min
  }

  const itemsRes = await fetch(api(`/datasets/${datasetId}/items?clean=true&format=json`, token), {
    signal: AbortSignal.timeout(60_000),
  });
  const items = await itemsRes.json();
  const list = Array.isArray(items) ? (items as Record<string, unknown>[]) : [];

  const adsByPageId = new Map<string, MetaAdLibraryAd[]>();
  let total = 0;
  for (const item of list) {
    const ad = mapApifyAd(item);
    if (!ad?.pageId) continue;
    const arr = adsByPageId.get(ad.pageId) ?? [];
    arr.push(ad);
    adsByPageId.set(ad.pageId, arr);
    total++;
  }
  return { adsByPageId, total };
}
