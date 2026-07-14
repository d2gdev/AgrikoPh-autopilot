import { createHash } from 'crypto';
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { type MetaAdLibraryAd } from "@/lib/connectors/meta-ad-library";
import { isApifyMetaEnabled, fetchApifyMetaAdsByPages } from "@/lib/connectors/apify-meta-ads";
import { fetchShoppingProducts } from "@/lib/connectors/dataforseo-shopping";
import { fetchRankedKeywords, fetchDomainIntersection, resolveLabsLimit } from "@/lib/connectors/dataforseo-labs";
import { fetchGoogleAdsKeywordIdeas } from "@/lib/connectors/google-ads";
import { fetchSerperShoppingProducts, type SerperShoppingProduct } from "@/lib/connectors/serper-shopping";
import { fetchCatalogProducts, type CatalogProduct } from "@/lib/shopify-admin";
import { fillCaptureTranslations } from "@/lib/market-intel/translate-captures";
import { fillCreativeAngles } from "@/lib/market-intel/classify-angles";
import { recordCompetitorAdCapture } from "@/lib/market-intel/ad-captures";
import { isSpamStoryAd } from "@/lib/market-intel/spam-filter";
import { resolveRunLimits, type MarketIntelRunOptions, type ResolvedLimits, type RunProfile } from "@/lib/market-intel/profiles";
import { gapIsStable } from "@/lib/market-intel/price-signal";
import { sendOperatorAlert } from "@/lib/alerts";
import type { JobResult, JobStatus } from "@/lib/jobs/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Trailing lookback window used to de-noise a single day's competitor price
// into a "smoothed" price for gap comparisons. Not operator-configurable —
// the config surface (PRICE_GAP_TASK_PCT / MIN_DAYS / OUTLIER_PCT) covers the
// thresholds; this window size is the fixed basis the "7d median" title text
// refers to.
const PRICE_GAP_WINDOW_DAYS = 7;

type MarketIntelSummary = {
  profile: RunProfile;
  effectiveLimits: ResolvedLimits;
  keywordsChecked: number;
  shoppingResults: number;
  competitorShoppingResults: number;
  priceRecords: number;
  priceRecordsCreated: number;
  priceRecordsUpdated: number;
  priceChanges: number;
  competitorPagesChecked: number;
  adsCaptured: number;
  apifyAdsFetched: number;
  apifyRan: boolean;
  spamAdsFiltered: number;
  adCaptures: number;
  adChangeInsights: number;
  newAds: number;
  longRunningAds: number;
  insightsCreated: number;
  insightsUpdated: number;
  disabledSources: string[];
  catalogProductsFetched: number;
  priceGapInsights: number;
  rankedKeywordsFetched: number;
  keywordGapCandidates: number;
  keywordGapInsights: number;
  zeroCaptureCompetitors: number;
};

function bareDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostAndPath = withoutProtocol.split(/[/?#]/)[0] ?? "";
  const host = hostAndPath.replace(/^www\./i, "").trim().toLowerCase();
  return host || null;
}

function slugPart(value: string | null | undefined) {
  return (value ?? "unknown")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "unknown";
}

// Google Shopping results can include Agriko's own listings (own site, or own
// storefronts on marketplaces) alongside genuine competitors. Price-gap
// detection must never compare Agriko's own price against itself and flag it
// as a "competitor" undercut. MARKET_INTEL_OWN_DOMAIN lets prod configure the
// own storefront domain if it ever differs from the default.
function isOwnListing(store: string | null | undefined, productUrl: string | null | undefined): boolean {
  const ownDomain = (process.env.MARKET_INTEL_OWN_DOMAIN?.trim() || "agrikoph.com").toLowerCase();
  const domain = bareDomain(productUrl);
  if (domain && (domain === ownDomain || domain.endsWith(`.${ownDomain}`))) return true;
  return (store ?? "").toLowerCase().includes("agriko");
}

function normalizeUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return value;
  }
}

function productContextKey(context: { kind: "market" | "competitor"; key: string }) {
  return `${context.kind}:${context.key}`;
}

function productKey(input: {
  title: string;
  brand?: string | null;
  store?: string | null;
  currency?: string | null;
  productUrl?: string | null;
  context: { kind: "market" | "competitor"; key: string };
}) {
  const parts = [
    productContextKey(input.context),
    normalizeUrl(input.productUrl),
    input.title,
    input.brand,
    input.store,
    input.currency,
  ].map(slugPart);
  return parts.join("|");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function keepExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function sanitizeRawPayload(value: Record<string, unknown>) {
  const copy = { ...value };
  for (const key of ["image", "imageUrl", "thumbnail", "thumbnailUrl", "images", "videos"]) {
    const field = copy[key];
    if (typeof field === "string" && field.startsWith("data:")) copy[key] = "[inline-data-url-removed]";
    if (Array.isArray(field)) {
      copy[key] = field.map((item) => typeof item === "string" && item.startsWith("data:") ? "[inline-data-url-removed]" : item);
    }
  }
  return copy;
}

function pctDelta(previous: number, current: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function daysBetween(older: Date, newer: Date) {
  return Math.floor((newer.getTime() - older.getTime()) / 86_400_000);
}

function captureDayRange(capturedAt: Date) {
  const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

type FetchMarketIntelOptions = MarketIntelRunOptions & { runId?: string };

async function getOrCreateRunId(runId?: string): Promise<string> {
  if (!runId) {
    const run = await prisma.jobRun.create({
      data: { jobName: "fetch-market-intel" },
      select: { id: true },
    });
    return run.id;
  }

  const existing = await prisma.jobRun.findUnique({
    where: { id: runId },
    select: { id: true, jobName: true },
  });
  if (!existing) {
    throw new Error(`Market intel run not found: ${runId}`);
  }
  if (existing.jobName !== "fetch-market-intel") {
    throw new Error(`Run ${runId} belongs to ${existing.jobName}, not fetch-market-intel`);
  }
  return existing.id;
}

export function computeProductIdentityHash(productUrl: string | null | undefined, title: string, store: string | null | undefined): string {
  const normalized = [
    (productUrl ?? '').toLowerCase().trim(),
    title.toLowerCase().trim(),
    (store ?? '').toLowerCase().trim(),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export async function saveShoppingResult(data: Prisma.ShoppingResultUncheckedCreateInput): Promise<"created" | "updated"> {
  const capturedAt = data.capturedAt instanceof Date ? data.capturedAt : new Date(String(data.capturedAt ?? Date.now()));
  const { start } = captureDayRange(capturedAt);
  const keyword = String(data.keyword);
  const productKeyValue = String(data.productKey);
  const captureDate = start;

  const existing = await prisma.shoppingResult.findUnique({
    where: {
      keyword_productKey_captureDate: {
        keyword,
        productKey: productKeyValue,
        captureDate,
      },
    },
    select: { id: true },
  });

  const payload: Prisma.ShoppingResultUncheckedCreateInput = {
    ...data,
    captureDate,
    productIdentityHash: computeProductIdentityHash(
      data.productUrl as string | undefined,
      String(data.title),
      data.store as string | undefined,
    ),
  } as Prisma.ShoppingResultUncheckedCreateInput;

  const shoppingUpdatePayload = { ...payload };
  delete shoppingUpdatePayload.captureDate;
  delete shoppingUpdatePayload.keyword;
  delete shoppingUpdatePayload.productKey;
  await prisma.shoppingResult.upsert({
    where: {
      keyword_productKey_captureDate: {
        keyword,
        productKey: productKeyValue,
        captureDate,
      },
    },
    create: payload,
    update: shoppingUpdatePayload as Prisma.ShoppingResultUncheckedUpdateInput,
  });

  return existing ? "updated" : "created";
}

export async function saveShoppingPriceHistory(data: Prisma.ShoppingPriceHistoryUncheckedCreateInput): Promise<"created" | "updated"> {
  const capturedAt = data.capturedAt instanceof Date ? data.capturedAt : new Date(String(data.capturedAt ?? Date.now()));
  const { start } = captureDayRange(capturedAt);
  const productKeyValue = String(data.productKey);
  const captureDate = start;
  const contextKey = data.marketKeywordId
    ? `market:${String(data.marketKeywordId)}`
    : data.competitorId
    ? `competitor:${String(data.competitorId)}`
    : "unknown";

  const existing = await prisma.shoppingPriceHistory.findUnique({
    where: {
      productKey_captureDate_contextKey: {
        productKey: productKeyValue,
        captureDate,
        contextKey,
      },
    },
    select: { id: true },
  });

  const payload: Prisma.ShoppingPriceHistoryUncheckedCreateInput = {
    ...data,
    captureDate: start,
    contextKey,
  } as Prisma.ShoppingPriceHistoryUncheckedCreateInput;

  const priceUpdatePayload = { ...payload };
  delete priceUpdatePayload.captureDate;
  delete priceUpdatePayload.productKey;
  delete priceUpdatePayload.contextKey;
  await prisma.shoppingPriceHistory.upsert({
    where: {
      productKey_captureDate_contextKey: {
        productKey: productKeyValue,
        captureDate,
        contextKey,
      },
    },
    create: payload,
    update: priceUpdatePayload as Prisma.ShoppingPriceHistoryUncheckedUpdateInput,
  });
  return existing ? "updated" : "created";
}

async function savePriceChangeInsight(data: Prisma.MarketInsightUncheckedCreateInput, capturedAt: Date, discriminator?: string): Promise<"created" | "updated"> {
  return saveOpenDailyMarketInsight(data, capturedAt, discriminator);
}

// `discriminator` is an optional extra key segment. price_change insights share
// type + competitor/keyword + day across every product, so without a per-product
// discriminator (the productKey) they collide on one dedupeKey and silently
// overwrite each other — losing all but the last product's insight. Appended
// only when provided, so existing (ad-based) insight keys are unchanged.
export async function saveOpenDailyMarketInsight(data: Prisma.MarketInsightUncheckedCreateInput, capturedAt: Date, discriminator?: string): Promise<"created" | "updated"> {
  const { start } = captureDayRange(capturedAt);
  const captureDay = start.toISOString().slice(0, 10); // YYYY-MM-DD
  const dedupeParts = [
    String(data.type),
    data.competitorId == null ? "" : String(data.competitorId),
    data.keywordId == null ? "" : String(data.keywordId),
    data.adId == null ? "" : String(data.adId),
    captureDay,
  ];
  if (discriminator) dedupeParts.push(String(discriminator));
  const dedupeKey = dedupeParts.join("|");

  const existing = await prisma.marketInsight.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });

  await prisma.marketInsight.upsert({
    where: { dedupeKey },
    create: { ...data, createdAt: capturedAt, dedupeKey },
    update: { ...data } as Prisma.MarketInsightUncheckedUpdateInput, // dedupeKey not in data shape — excluded from update by design
  });
  return existing ? "updated" : "created";
}

export async function fetchMarketIntelHandler(
  options: FetchMarketIntelOptions = { profile: "scheduled" },
): Promise<JobResult<MarketIntelSummary>> {
  const runId = await getOrCreateRunId(options.runId);
  const limits = resolveRunLimits(options);
  const { keywordLimit, shoppingResultLimit, competitorPageLimit, adLimitPerPage, longRunningAdDays, sources } = limits;

  const errors: string[] = [];
  const disabledSources = new Set<string>();
  const capturedAt = new Date();
  const summary: MarketIntelSummary = {
    profile: options.profile,
    effectiveLimits: limits,
    keywordsChecked: 0,
    shoppingResults: 0,
    competitorShoppingResults: 0,
    priceRecords: 0,
    priceRecordsCreated: 0,
    priceRecordsUpdated: 0,
    priceChanges: 0,
    competitorPagesChecked: 0,
    adsCaptured: 0,
    apifyAdsFetched: 0,
    apifyRan: false,
    spamAdsFiltered: 0,
    adCaptures: 0,
    adChangeInsights: 0,
    newAds: 0,
    longRunningAds: 0,
    insightsCreated: 0,
    insightsUpdated: 0,
    disabledSources: [],
    catalogProductsFetched: 0,
    priceGapInsights: 0,
    rankedKeywordsFetched: 0,
    keywordGapCandidates: 0,
    keywordGapInsights: 0,
    zeroCaptureCompetitors: 0,
  };

  if (process.env.MARKET_INTEL_ENABLED === "false") {
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status: "success",
        summary: json({ ...summary, disabledSources: ["market_intel_disabled"] }),
      },
    });
    return {
      jobName: "fetch-market-intel",
      runId: runId,
      status: "success",
      summary: { ...summary, disabledSources: ["market_intel_disabled"] },
      errors,
    };
  }

  try {
  // Own-catalog ingestion: pull Agriko's own products/variants from Shopify Admin
  // and snapshot them as RawSnapshot("shopify_catalog") for the capture day. Feeds
  // the price-gap detection step below. Failure here must not block the rest of
  // market intel (ad captures, shopping results, etc.) — log and continue with an
  // empty catalog, which naturally yields zero price-gap matches.
  let ownProducts: CatalogProduct[] = [];
  if (sources.includes("shopping")) {
    try {
      ownProducts = await fetchCatalogProducts();
      summary.catalogProductsFetched = ownProducts.length;
      const { start: catalogDayStart } = captureDayRange(capturedAt);
      await prisma.rawSnapshot.upsert({
        where: {
          source_dateRangeStart_dateRangeEnd: {
            source: "shopify_catalog",
            dateRangeStart: catalogDayStart,
            dateRangeEnd: catalogDayStart,
          },
        },
        create: {
          source: "shopify_catalog",
          dateRangeStart: catalogDayStart,
          dateRangeEnd: catalogDayStart,
          payload: json(ownProducts),
          jobRunId: runId,
        },
        update: {
          payload: json(ownProducts),
          jobRunId: runId,
          fetchedAt: new Date(),
        },
      });
    } catch (err) {
      errors.push(`shopify_catalog: ${String(err)}`);
    }
  }

  const keywords = sources.includes("shopping") ? await prisma.marketKeyword.findMany({
    where: { active: true, category: { not: "seo" } },
    orderBy: { createdAt: "asc" },
    take: keywordLimit,
  }) : [];

  for (const keyword of keywords) {
    summary.keywordsChecked++;
    try {
      const serperResult = await fetchSerperShoppingProducts({
        keyword: keyword.keyword,
        countryCode: process.env.MARKET_INTEL_DEFAULT_COUNTRY ?? "ph",
        languageCode: keyword.languageCode,
        limit: shoppingResultLimit,
      });
      const result = serperResult.disabled
        ? await fetchShoppingProducts({
          keyword: keyword.keyword,
          locationName: keyword.locationName,
          languageCode: keyword.languageCode,
        })
        : serperResult;
      if (serperResult.disabled && result.disabled) {
        disabledSources.add("serper");
        disabledSources.add("dataforseo");
        continue;
      }

      for (const product of result.products.slice(0, shoppingResultLimit)) {
        const key = productKey({
          ...product,
          context: { kind: "market", key: keyword.id },
        });
        await saveShoppingResult({
          jobRunId: runId,
          marketKeywordId: keyword.id,
          keyword: keyword.keyword,
          title: product.title,
          brand: product.brand,
          price: product.price,
          currency: product.currency,
          store: product.store,
          rating: product.rating,
          reviewCount: product.reviewCount != null ? Math.round(product.reviewCount) : null,
          searchPosition: product.searchPosition != null ? Math.round(product.searchPosition) : null,
          productUrl: product.productUrl,
          imageUrl: keepExternalUrl(product.imageUrl),
          productKey: key,
          capturedAt,
          rawPayload: json(sanitizeRawPayload(product.rawPayload)),
        });
        summary.shoppingResults++;

        if (product.price == null) continue;
        const { start: captureDayStart } = captureDayRange(capturedAt);

        const previous = await prisma.shoppingPriceHistory.findFirst({
          where: {
            productKey: key,
            marketKeywordId: keyword.id,
            capturedAt: { lt: captureDayStart },
          },
          orderBy: { capturedAt: "desc" },
        });
        const priceDelta = previous ? product.price - previous.price : null;
        const priceDeltaPct = previous && priceDelta != null ? pctDelta(previous.price, product.price) : null;

        const priceWrite = await saveShoppingPriceHistory({
          jobRunId: runId,
          marketKeywordId: keyword.id,
          productKey: key,
          title: product.title,
          store: product.store,
          price: product.price,
          currency: product.currency,
          previousPrice: previous?.price,
          priceDelta,
          priceDeltaPct,
          capturedAt,
        });
        summary.priceRecords++;
        if (priceWrite === "created") summary.priceRecordsCreated++;
        else summary.priceRecordsUpdated++;

        if (previous && priceDelta != null && Math.abs(priceDelta) >= 0.01) {
          const severity = priceDeltaPct != null && Math.abs(priceDeltaPct) >= 10 ? "warning" : "info";
          const insightWrite = await savePriceChangeInsight({
            type: "price_change",
            severity,
            title: `${product.store ?? "Competitor"} price changed`,
            summary: `${product.title} changed from ${previous.price} to ${product.price}${product.currency ? ` ${product.currency}` : ""}.`,
            evidence: json({
              productKey: key,
              keyword: keyword.keyword,
              previousPrice: previous.price,
              currentPrice: product.price,
              priceDelta,
              priceDeltaPct,
              productUrl: product.productUrl,
            }),
            keywordId: keyword.id,
          }, capturedAt, key);
          summary.priceChanges++;
          if (insightWrite === "created") summary.insightsCreated++;
          else summary.insightsUpdated++;
        }
      }
    } catch (err) {
      errors.push(`shopping:${keyword.keyword}: ${String(err)}`);
    }
  }

  // Per-competitor Google Shopping catalog pull (Serper). Pulls each competitor's
  // products by brand name (q = competitor.name, num=40 ≈ 2 credits each). Gated to
  // ~weekly via a 6-day recency check, and scoped to curated competitors (active +
  // an active social page) so junk rows aren't queried. Kill-switch: COMPETITOR_SHOPPING_ENABLED.
  if (sources.includes("shopping") && process.env.COMPETITOR_SHOPPING_ENABLED !== "false") {
    const sixDaysAgo = new Date(capturedAt.getTime() - 6 * 24 * 60 * 60 * 1000);
    const recentCompShopping = await prisma.shoppingResult.findFirst({
      where: { competitorId: { not: null }, capturedAt: { gte: sixDaysAgo } },
      select: { id: true },
    });
    if (recentCompShopping) {
      // Already pulled within the weekly window — skip to conserve credits.
    } else {
      const competitors = await prisma.competitor.findMany({
        where: { active: true, socialPages: { some: { active: true } } },
        orderBy: { name: "asc" },
      });
      for (const competitor of competitors) {
        try {
          // Google Shopping returns ~40 results/page; paginate for deeper catalog
          // coverage (2 pages ≈ 80 products, ~4 credits/competitor). Dedup by productKey.
          const COMPETITOR_SHOPPING_PAGES = 2;
          const productsByKey = new Map<string, SerperShoppingProduct>();
          let serperDisabled = false;
          for (let pageNum = 1; pageNum <= COMPETITOR_SHOPPING_PAGES; pageNum++) {
            const pageResult = await fetchSerperShoppingProducts({
              keyword: competitor.name,
              countryCode: process.env.MARKET_INTEL_DEFAULT_COUNTRY ?? "ph",
              limit: 40,
              page: pageNum,
            });
            if (pageResult.disabled) {
              serperDisabled = true;
              break;
            }
            for (const product of pageResult.products) {
              const k = productKey({
                ...product,
                context: { kind: "competitor", key: competitor.id },
              });
              if (!productsByKey.has(k)) productsByKey.set(k, product);
            }
            if (pageResult.products.length < 40) break; // last page reached
          }
          // Persist whatever was collected before a mid-pagination Serper
          // disable — page-1 products (already fetched and paid for) must not
          // be dropped just because a later page hit the quota wall. We stop
          // querying further competitors only AFTER saving (below).
          for (const product of productsByKey.values()) {
            const key = productKey({
              ...product,
              context: { kind: "competitor", key: competitor.id },
            });
            await saveShoppingResult({
              jobRunId: runId,
              competitorId: competitor.id,
              keyword: competitor.name,
              title: product.title,
              brand: product.brand,
              price: product.price,
              currency: product.currency,
              store: product.store,
              rating: product.rating,
              reviewCount: product.reviewCount != null ? Math.round(product.reviewCount) : null,
              searchPosition: product.searchPosition != null ? Math.round(product.searchPosition) : null,
              productUrl: product.productUrl,
              imageUrl: keepExternalUrl(product.imageUrl),
              productKey: key,
              capturedAt,
              rawPayload: json(sanitizeRawPayload(product.rawPayload)),
            });
            summary.competitorShoppingResults++;

            if (product.price == null) continue;
            const { start: captureDayStart } = captureDayRange(capturedAt);

            const previous = await prisma.shoppingPriceHistory.findFirst({
              where: {
                productKey: key,
                competitorId: competitor.id,
                capturedAt: { lt: captureDayStart },
              },
              orderBy: { capturedAt: "desc" },
            });
            const priceDelta = previous ? product.price - previous.price : null;
            const priceDeltaPct = previous && priceDelta != null ? pctDelta(previous.price, product.price) : null;

            const priceWrite = await saveShoppingPriceHistory({
              jobRunId: runId,
              competitorId: competitor.id,
              productKey: key,
              title: product.title,
              store: product.store,
              price: product.price,
              currency: product.currency,
              previousPrice: previous?.price,
              priceDelta,
              priceDeltaPct,
              capturedAt,
            });
            summary.priceRecords++;
            if (priceWrite === "created") summary.priceRecordsCreated++;
            else summary.priceRecordsUpdated++;

            if (previous && priceDelta != null && Math.abs(priceDelta) >= 0.01) {
              const severity = priceDeltaPct != null && Math.abs(priceDeltaPct) >= 10 ? "warning" : "info";
              const insightWrite = await savePriceChangeInsight({
                type: "price_change",
                severity,
                title: `${competitor.name} price changed`,
                summary: `${product.title} changed from ${previous.price} to ${product.price}${product.currency ? ` ${product.currency}` : ""}.`,
                evidence: json({
                  productKey: key,
                  competitor: competitor.name,
                  previousPrice: previous.price,
                  currentPrice: product.price,
                  priceDelta,
                  priceDeltaPct,
                  productUrl: product.productUrl,
                }),
                competitorId: competitor.id,
              }, capturedAt, key);
              summary.priceChanges++;
              if (insightWrite === "created") summary.insightsCreated++;
              else summary.insightsUpdated++;
            }
          }
          // Now that page-1 products are persisted, stop hammering a disabled
          // Serper across the remaining competitors.
          if (serperDisabled) {
            disabledSources.add("serper");
            break;
          }
        } catch (err) {
          errors.push(`competitor-shopping:${competitor.name}: ${String(err)}`);
        }
      }
    }
  }

  // Own-catalog price-gap detection: runs after all of today's ShoppingResult
  // rows (both market-search and competitor-search) are persisted above, so it
  // sees the full picture for the capture day. For each active keyword, match
  // own products whose title contains the keyword (case-insensitive substring —
  // deliberately conservative, no fuzzy scoring), then check each competing
  // store's TRAILING price history (not just today's single scrape) for a
  // gap that has been stably present for `minDays` days — a single noisy
  // scrape must never trigger an insight on its own.
  // A catalog-fetch failure above leaves ownProducts empty, which naturally
  // yields zero matches here (no separate guard needed).
  if (sources.includes("shopping") && ownProducts.length > 0) {
    const { start: gapDayStart } = captureDayRange(capturedAt);

    const cfg = Object.fromEntries((await prisma.guardrailConfig.findMany({
      where: { key: { in: ["PRICE_GAP_TASK_PCT", "PRICE_GAP_MIN_DAYS", "PRICE_OUTLIER_PCT"] } },
    })).map((c) => [c.key, Number(c.value)]));
    const gapPct = cfg.PRICE_GAP_TASK_PCT ?? 10;
    const minDays = cfg.PRICE_GAP_MIN_DAYS ?? 14;
    const outlierPct = cfg.PRICE_OUTLIER_PCT ?? 40;

    for (const keyword of keywords) {
      try {
        const matchedProducts = ownProducts.filter((p) =>
          p.title.toLowerCase().includes(keyword.keyword.toLowerCase())
        );
        if (matchedProducts.length === 0) continue;

        const latestResults = await prisma.shoppingResult.findMany({
          where: { keyword: keyword.keyword, captureDate: gapDayStart },
        });
        if (latestResults.length === 0) continue;

        // One representative row per competing store for today's capture day
        // (the store's price-history series, keyed by that row's productKey,
        // is what actually drives the gap decision — not this raw price).
        const byStore = new Map<string, (typeof latestResults)[number]>();
        for (const result of latestResults) {
          if (result.price == null || !Number.isFinite(result.price) || result.price <= 0) continue;
          const store = result.store?.trim();
          if (!store) continue;
          if (isOwnListing(store, result.productUrl)) continue;
          if (!byStore.has(store)) byStore.set(store, result);
        }
        if (byStore.size === 0) continue;

        for (const ownProduct of matchedProducts) {
          // Cheapest variant price stands in for "the product's price" when a
          // product has multiple variants — noted explicitly in evidence below.
          const variantPrices = ownProduct.variants
            .map((v) => Number.parseFloat(v.price))
            .filter((price) => Number.isFinite(price) && price > 0);
          if (variantPrices.length === 0) continue;
          const ownPrice = Math.min(...variantPrices);

          for (const [store, result] of byStore) {
            const series = await prisma.shoppingPriceHistory.findMany({
              where: {
                productKey: result.productKey,
                capturedAt: { gte: new Date(capturedAt.getTime() - (PRICE_GAP_WINDOW_DAYS + minDays) * MS_PER_DAY) },
              },
              select: { price: true, capturedAt: true },
            });

            const stability = gapIsStable({
              ownPrice,
              series,
              gapPct,
              minDays,
              windowDays: PRICE_GAP_WINDOW_DAYS,
              outlierPct,
              asOf: capturedAt,
            });
            if (!stability.stable || stability.smoothed == null) continue;

            const existingOpen = await prisma.marketInsight.findFirst({
              where: {
                type: "price_gap",
                status: "open",
                keywordId: keyword.id,
                evidence: { path: ["store"], equals: store },
              },
              select: { id: true },
            });
            if (existingOpen) continue;

            const smoothedPrice = stability.smoothed;
            const roundedGap = Math.round(stability.gapPctNow ?? 0);
            const severity = roundedGap > 25 ? "critical" : "warning";
            await prisma.marketInsight.create({
              data: {
                type: "price_gap",
                severity,
                title: `Review pricing for ${ownProduct.title}: ${store} at ₱${smoothedPrice} (7d median) vs ours ₱${ownPrice} for ${stability.daysStable}+ days`,
                summary: `${store} lists ${result.title} at a smoothed 7d-median price of ${smoothedPrice}${result.currency ? ` ${result.currency}` : ""}, ${roundedGap}% below Agriko's ${ownProduct.title} at ${ownPrice}, stable for ${stability.daysStable}+ day(s).`,
                evidence: json({
                  keyword: keyword.keyword,
                  store,
                  ownProductId: ownProduct.id,
                  ownProductTitle: ownProduct.title,
                  ownProductHandle: ownProduct.handle,
                  ownPrice,
                  ownPriceNote: "cheapest variant price among all of the product's variants",
                  competitorTitle: result.title,
                  competitorPrice: result.price,
                  competitorCurrency: result.currency,
                  competitorProductUrl: result.productUrl,
                  competitorShoppingResultId: result.id,
                  gapPct: roundedGap,
                  smoothedPrice,
                  daysStable: stability.daysStable,
                  thresholds: { gapPct, minDays, outlierPct },
                }),
                keywordId: keyword.id,
                dedupeKey: `price_gap|${keyword.id}|${slugPart(store)}|${capturedAt.toISOString()}`,
              },
            });
            summary.insightsCreated++;
            summary.priceGapInsights++;
          }
        }
      } catch (err) {
        errors.push(`price_gap:${keyword.keyword}: ${String(err)}`);
      }
    }
  }

  // DataForSEO Labs: ranked keywords for our own domain + competitor keyword-gap
  // detection. This is a metered API — the whole step is skipped (no fetch, no
  // RawSnapshot writes) unless DATAFORSEO_LABS_ENABLED=true. Off by default so
  // nothing spends money until an operator opts in.
  if (process.env.DATAFORSEO_LABS_ENABLED === "true") {
    const ownDomain = bareDomain(process.env.MARKET_INTEL_OWN_DOMAIN) ?? "agrikoph.com";
    const labsLimit = resolveLabsLimit(undefined);
    const { start: labsDayStart } = captureDayRange(capturedAt);
    let useGoogleAdsKeywordGapFallback = false;

    try {
      const ranked = await fetchRankedKeywords(ownDomain, labsLimit);
      if (ranked.disabled) {
        console.log("[fetch-market-intel] dataforseo_labs: skipped ranked-keywords fetch (missing credentials)");
      } else {
        summary.rankedKeywordsFetched = ranked.items.length;
        await prisma.rawSnapshot.upsert({
          where: {
            source_dateRangeStart_dateRangeEnd: {
              source: "dataforseo_ranked",
              dateRangeStart: labsDayStart,
              dateRangeEnd: labsDayStart,
            },
          },
          create: {
            source: "dataforseo_ranked",
            dateRangeStart: labsDayStart,
            dateRangeEnd: labsDayStart,
            payload: json({ domain: ownDomain, topQueries: ranked.items }),
            jobRunId: runId,
          },
          update: {
            payload: json({ domain: ownDomain, topQueries: ranked.items }),
            jobRunId: runId,
            fetchedAt: new Date(),
          },
        });
      }
    } catch (err) {
      if (/DataForSEO error 402\b/.test(String(err))) {
        useGoogleAdsKeywordGapFallback = true;
        console.warn("[fetch-market-intel] dataforseo_labs: account unavailable; using Google Ads URL ideas for keyword gaps");
      } else {
        errors.push(`dataforseo_ranked: ${String(err)}`);
      }
    }

    if (useGoogleAdsKeywordGapFallback) {
      try {
        const competitorCandidates = await prisma.competitor.findMany({
          where: { active: true, domain: { not: null } },
          orderBy: { name: "asc" },
          take: 10,
        });
        const competitors = competitorCandidates
          .map((competitor) => ({ competitor, competitorDomain: bareDomain(competitor.domain) }))
          .filter((entry): entry is { competitor: (typeof competitorCandidates)[number]; competitorDomain: string } => entry.competitorDomain != null)
          .slice(0, 3);
        const ownIdeas = await fetchGoogleAdsKeywordIdeas({
          seedKeywords: [],
          pageUrl: `https://${ownDomain}`,
          limit: labsLimit,
        });

        if (ownIdeas.disabled) {
          disabledSources.add("google_ads");
        } else {
          const ownKeywords = new Set(ownIdeas.results.map((item) => item.keyword.toLowerCase()));
          const gapsByCompetitor: Array<{ competitorId: string; competitorName: string; domain: string; items: Array<{ keyword: string; searchVolume: number | null; cpc: number | null }> }> = [];

          for (const { competitor, competitorDomain } of competitors) {
            const ideas = await fetchGoogleAdsKeywordIdeas({
              seedKeywords: [],
              pageUrl: `https://${competitorDomain}`,
              limit: labsLimit,
            });
            if (ideas.disabled) {
              disabledSources.add("google_ads");
              break;
            }
            const items = ideas.results
              .filter((item) => !ownKeywords.has(item.keyword.toLowerCase()))
              .map((item) => ({
                keyword: item.keyword,
                searchVolume: item.avgMonthlySearches ?? null,
                cpc: item.highTopOfPageBidMicros == null ? null : Number(item.highTopOfPageBidMicros) / 1_000_000,
              }))
              .slice(0, labsLimit);
            if (items.length > 0) {
              gapsByCompetitor.push({
                competitorId: competitor.id,
                competitorName: competitor.name,
                domain: competitorDomain,
                items,
              });
            }
          }

          if (gapsByCompetitor.length > 0) {
            await prisma.rawSnapshot.upsert({
              where: {
                source_dateRangeStart_dateRangeEnd: {
                  source: "google_ads_keyword_gap",
                  dateRangeStart: labsDayStart,
                  dateRangeEnd: labsDayStart,
                },
              },
              create: {
                source: "google_ads_keyword_gap",
                dateRangeStart: labsDayStart,
                dateRangeEnd: labsDayStart,
                payload: json({ ownDomain, competitors: gapsByCompetitor }),
                jobRunId: runId,
              },
              update: {
                payload: json({ ownDomain, competitors: gapsByCompetitor }),
                jobRunId: runId,
                fetchedAt: new Date(),
              },
            });

            outerGoogleAdsGap:
            for (const group of gapsByCompetitor) {
              for (const item of group.items) {
                if (summary.keywordGapInsights >= 10) break outerGoogleAdsGap;
                if (item.searchVolume == null || item.searchVolume < 100) continue;
                summary.keywordGapCandidates++;
                const existingOpen = await prisma.marketInsight.findFirst({
                  where: {
                    type: "keyword_gap",
                    status: "open",
                    evidence: { path: ["keyword"], equals: item.keyword },
                  },
                  select: { id: true },
                });
                if (existingOpen) continue;
                await prisma.marketInsight.create({
                  data: {
                    type: "keyword_gap",
                    severity: "info",
                    title: `${group.competitorName} covers "${item.keyword}" — Agriko opportunity`,
                    summary: `Google Ads Keyword Planner found "${item.keyword}" from ${group.competitorName}'s site (${group.domain}, ~${item.searchVolume}/mo) but not from ${ownDomain}'s site.`,
                    evidence: json({
                      source: "google_ads_url_seed",
                      keyword: item.keyword,
                      competitorDomain: group.domain,
                      searchVolume: item.searchVolume,
                      cpc: item.cpc,
                      ownDomain,
                    }),
                    competitorId: group.competitorId,
                    dedupeKey: `keyword_gap|google_ads_url_seed|${group.competitorId}|${slugPart(item.keyword)}|${capturedAt.toISOString()}`,
                  },
                });
                summary.insightsCreated++;
                summary.keywordGapInsights++;
              }
            }
          }
        }
      } catch (err) {
        errors.push(`google_ads_keyword_gap: ${String(err)}`);
      }
    } else try {
      // Fetch a wider candidate set, then filter to competitors whose domain
      // survives bareDomain() normalization — a non-null-but-unusable value
      // (whitespace, protocol-only, etc.) must not waste one of the 3 metered
      // slots. The hard cap of 3 actual intersection API calls is applied
      // AFTER the usability filter, via slice(0, 3).
      const competitorCandidates = await prisma.competitor.findMany({
        where: { active: true, domain: { not: null } },
        orderBy: { name: "asc" },
        take: 10,
      });
      const competitors = competitorCandidates
        .map((competitor) => ({ competitor, competitorDomain: bareDomain(competitor.domain) }))
        .filter((entry): entry is { competitor: (typeof competitorCandidates)[number]; competitorDomain: string } => entry.competitorDomain != null)
        .slice(0, 3);

      const gapsByCompetitor: Array<{ competitorId: string; competitorName: string; domain: string; items: Awaited<ReturnType<typeof fetchDomainIntersection>>["items"] }> = [];
      let labsDisabled = false;

      for (const { competitor, competitorDomain } of competitors) {
        try {
          const intersection = await fetchDomainIntersection(ownDomain, competitorDomain, labsLimit);
          if (intersection.disabled) {
            labsDisabled = true;
            break;
          }
          gapsByCompetitor.push({
            competitorId: competitor.id,
            competitorName: competitor.name,
            domain: competitorDomain,
            items: intersection.items,
          });
        } catch (err) {
          errors.push(`dataforseo_keyword_gap:${competitor.name}: ${String(err)}`);
        }
      }

      if (labsDisabled && gapsByCompetitor.length === 0) {
        console.log("[fetch-market-intel] dataforseo_labs: skipped keyword-gap fetch (missing credentials)");
      } else if (gapsByCompetitor.length > 0) {
        await prisma.rawSnapshot.upsert({
          where: {
            source_dateRangeStart_dateRangeEnd: {
              source: "dataforseo_keyword_gap",
              dateRangeStart: labsDayStart,
              dateRangeEnd: labsDayStart,
            },
          },
          create: {
            source: "dataforseo_keyword_gap",
            dateRangeStart: labsDayStart,
            dateRangeEnd: labsDayStart,
            payload: json({ ownDomain, competitors: gapsByCompetitor }),
            jobRunId: runId,
          },
          update: {
            payload: json({ ownDomain, competitors: gapsByCompetitor }),
            jobRunId: runId,
            fetchedAt: new Date(),
          },
        });

        // Material gap: competitor ranks top-10, volume >= 100, and we're
        // absent from the intersection result (fetchDomainIntersection already
        // filters to "competitor ranks, we don't"). Capped 10/run, deduped by
        // keyword against any OPEN keyword_gap insight (mirrors price_gap's
        // dedup-by-open-insight pattern above).
        outer:
        for (const group of gapsByCompetitor) {
          for (const item of group.items) {
            if (summary.keywordGapInsights >= 10) break outer;
            if (item.competitorPosition == null || item.competitorPosition > 10) continue;
            if (item.searchVolume == null || item.searchVolume < 100) continue;
            summary.keywordGapCandidates++;

            const existingOpen = await prisma.marketInsight.findFirst({
              where: {
                type: "keyword_gap",
                status: "open",
                evidence: { path: ["keyword"], equals: item.keyword },
              },
              select: { id: true },
            });
            if (existingOpen) continue;

            await prisma.marketInsight.create({
              data: {
                type: "keyword_gap",
                severity: "info",
                title: `${group.competitorName} ranks for "${item.keyword}" — we don't`,
                summary: `${group.competitorName} ranks #${item.competitorPosition} for "${item.keyword}" (search volume ~${item.searchVolume}/mo) while ${ownDomain} does not appear.`,
                evidence: json({
                  keyword: item.keyword,
                  competitorDomain: group.domain,
                  competitorPosition: item.competitorPosition,
                  searchVolume: item.searchVolume,
                  cpc: item.cpc,
                  ownDomain,
                }),
                competitorId: group.competitorId,
                dedupeKey: `keyword_gap|${group.competitorId}|${slugPart(item.keyword)}|${capturedAt.toISOString()}`,
              },
            });
            summary.insightsCreated++;
            summary.keywordGapInsights++;
          }
        }
      }
    } catch (err) {
      errors.push(`dataforseo_keyword_gap: ${String(err)}`);
    }
  } else {
    console.log("[fetch-market-intel] dataforseo_labs: disabled (set DATAFORSEO_LABS_ENABLED=true to enable)");
  }

  const socialPages = sources.includes("meta") ? await prisma.competitorSocialPage.findMany({
    where: { active: true, platform: { in: ["facebook", "instagram", "meta", "meta_keyword"] } },
    include: { competitor: true },
    orderBy: { createdAt: "asc" },
    take: competitorPageLimit,
  }) : [];

  // Prefer Apify (rich title/cta/landing-URL fields) for competitor pages with a
  // numeric page_id; fall back to the in-house scraper otherwise. Apify is metered
  // (free credit), so pull at most ~weekly — skip if a fresh Apify capture exists.
  let useApify = await isApifyMetaEnabled();
  if (useApify) {
    const sixDaysAgo = new Date(capturedAt.getTime() - 6 * 24 * 60 * 60 * 1000);
    const recentApify = await prisma.competitorAd.findFirst({
      where: { rawPayload: { path: ["source"], equals: "apify" }, capturedAt: { gte: sixDaysAgo } },
      select: { id: true },
    });
    if (recentApify) useApify = false;
  }
  let apifyAdsByPage = new Map<string, MetaAdLibraryAd[]>();
  if (useApify) {
    const numericPageIds = socialPages
      .map((p) => p.pageId)
      .filter((id): id is string => Boolean(id) && /^\d+$/.test(id ?? ""));
    if (numericPageIds.length) {
      try {
        const apify = await fetchApifyMetaAdsByPages(numericPageIds, { perPage: adLimitPerPage });
        apifyAdsByPage = apify.adsByPageId;
        summary.apifyAdsFetched = apify.total;
        summary.apifyRan = !apify.disabled;
      } catch (err) {
        errors.push(`apify_meta: ${String(err)}`);
      }
    }
  }

  for (const page of socialPages) {
    // Apify-only: competitor pages get rich data or are skipped. No scraper fallback.
    const apifyAds = page.pageId ? apifyAdsByPage.get(page.pageId) : undefined;
    if (!apifyAds || !apifyAds.length) continue;
    summary.competitorPagesChecked++;
    try {
      const result = { ads: apifyAds.slice(0, adLimitPerPage) };

      for (const ad of result.ads.slice(0, adLimitPerPage)) {
        // Skip spam serialized-story creatives (content-farm novelette ads)
        // that match broad keyword searches but are never real competitors.
        if (isSpamStoryAd(ad)) {
          summary.spamAdsFiltered++;
          continue;
        }
        const existing = await prisma.competitorAd.findUnique({
          where: { adArchiveId: ad.adArchiveId },
          select: {
            id: true,
            adCopy: true,
            headline: true,
            description: true,
            cta: true,
            landingPageUrl: true,
            activeStatus: true,
            creativeType: true,
            imageUrl: true,
            videoUrl: true,
            capturedAt: true,
          },
        });
        const saved = await prisma.competitorAd.upsert({
          where: { adArchiveId: ad.adArchiveId },
          create: {
            jobRunId: runId,
            competitorId: page.competitorId,
            pageName: ad.pageName ?? page.pageName,
            pageId: ad.pageId ?? page.pageId,
            adArchiveId: ad.adArchiveId,
            adCopy: ad.adCopy,
            headline: ad.headline,
            description: ad.description,
            cta: ad.cta,
            landingPageUrl: ad.landingPageUrl,
            adSnapshotUrl: ad.adSnapshotUrl,
            platforms: json(ad.platforms ?? []),
            startDate: ad.startDate,
            endDate: ad.endDate,
            activeStatus: ad.activeStatus,
            creativeType: ad.creativeType,
            imageUrl: keepExternalUrl(ad.imageUrl),
            videoUrl: keepExternalUrl(ad.videoUrl),
            capturedAt,
            rawPayload: json(sanitizeRawPayload(ad.rawPayload)),
          },
          update: {
            jobRunId: runId,
            pageName: ad.pageName ?? page.pageName,
            pageId: ad.pageId ?? page.pageId,
            adCopy: ad.adCopy,
            headline: ad.headline,
            description: ad.description,
            cta: ad.cta,
            landingPageUrl: ad.landingPageUrl,
            adSnapshotUrl: ad.adSnapshotUrl,
            platforms: json(ad.platforms ?? []),
            startDate: ad.startDate,
            endDate: ad.endDate,
            activeStatus: ad.activeStatus,
            creativeType: ad.creativeType,
            imageUrl: keepExternalUrl(ad.imageUrl),
            videoUrl: keepExternalUrl(ad.videoUrl),
            capturedAt,
            rawPayload: json(sanitizeRawPayload(ad.rawPayload)),
          },
        });
        summary.adsCaptured++;

        const captureResult = await recordCompetitorAdCapture(prisma, {
          competitorAdId: saved.id,
          competitorId: page.competitorId,
          competitorName: page.competitor.name,
          jobRunId: runId,
          capturedAt,
          ad,
          savedAd: {
            adArchiveId: saved.adArchiveId,
            adCopy: saved.adCopy,
            adCopyEn: saved.adCopyEn,
            headline: saved.headline,
            headlineEn: saved.headlineEn,
            description: saved.description,
            cta: saved.cta,
            landingPageUrl: saved.landingPageUrl,
            activeStatus: saved.activeStatus,
            creativeType: saved.creativeType,
            creativeAngle: saved.creativeAngle,
            imageUrl: saved.imageUrl,
            videoUrl: saved.videoUrl,
            rawPayload: saved.rawPayload,
          },
          previousAd: existing,
        });
        if (captureResult.created) summary.adCaptures++;
        if (captureResult.insightsCreated > 0) {
          summary.adChangeInsights += captureResult.insightsCreated;
          summary.insightsCreated += captureResult.insightsCreated;
        }

        if (ad.activeStatus === "ACTIVE" && ad.startDate) {
          const runningDays = daysBetween(ad.startDate, capturedAt);
          if (runningDays >= longRunningAdDays) {
            summary.longRunningAds++;
            const insightWrite = await saveOpenDailyMarketInsight({
              type: "long_running_competitor_ad",
              severity: "warning",
              title: `${page.competitor.name} has an ad running ${runningDays} days`,
              summary: ad.headline ?? ad.adCopy ?? `This active Meta ad has been running for at least ${longRunningAdDays} days.`,
              evidence: json({
                adArchiveId: ad.adArchiveId,
                pageName: ad.pageName ?? page.pageName,
                adSnapshotUrl: ad.adSnapshotUrl,
                platforms: ad.platforms ?? [],
                startDate: ad.startDate.toISOString(),
                runningDays,
                thresholdDays: longRunningAdDays,
              }),
              competitorId: page.competitorId,
              adId: saved.id,
            }, capturedAt);

            if (insightWrite === "created") {
              summary.insightsCreated++;
            } else {
              summary.insightsUpdated++;
            }
          }
        }

        if (!existing) {
          const insightWrite = await saveOpenDailyMarketInsight({
            type: "new_competitor_ad",
            severity: "info",
            title: `${page.competitor.name} launched or exposed a new ad`,
            summary: ad.headline ?? ad.adCopy ?? "A new Meta Ad Library creative was captured.",
            evidence: json({
              adArchiveId: ad.adArchiveId,
              pageName: ad.pageName ?? page.pageName,
              adSnapshotUrl: ad.adSnapshotUrl,
              platforms: ad.platforms ?? [],
              startDate: ad.startDate?.toISOString(),
            }),
            competitorId: page.competitorId,
            adId: saved.id,
          }, capturedAt);
          summary.newAds++;
          if (insightWrite === "created") summary.insightsCreated++;
          else summary.insightsUpdated++;
        }
      }
    } catch (err) {
      errors.push(`meta_ad_library:${page.pageName}: ${String(err)}`);
    }
  }

  // Zero-capture watchdog ("the Falo problem"): a competitor's ad-capture
  // pipeline can silently return zero ads indefinitely — a misconfigured
  // page (name/URL instead of the required numeric page ID) looks exactly
  // like a brand that runs no ads. Nothing errors, the row just never lands.
  // Flag competitors with 7 straight historical Apify pulls + this pull
  // producing zero captures, and either a history of captures existing at
  // all (something broke) or a missing pageId (never configured correctly).
  //
  // Windowed over Apify PULLS, not job runs: Apify executes ~weekly (skipped
  // when a fresh capture exists), so daily runs in between carry no signal
  // about whether a competitor's ads are capturable. Counting them made any
  // competitor absent from a single weekly pull trip the watchdog within 8
  // days (2026-07-05: fired 17 false positives, every one with a valid
  // numeric pageId). Only runs that actually pulled count as evidence, and
  // the watchdog only evaluates immediately after a pull.
  try {
    const recentRuns = summary.apifyRan
      ? await prisma.jobRun.findMany({
          where: { jobName: "fetch-market-intel", status: { in: ["success", "partial"] }, id: { not: runId } },
          orderBy: { completedAt: "desc" },
          take: 40,
          select: { id: true, summary: true },
        })
      : [];
    // Older runs predate the apifyRan summary field — an apifyAdsFetched > 0
    // count is equally conclusive evidence that a pull happened.
    const historicalRuns = recentRuns
      .filter((run) => {
        const s = run.summary as { apifyRan?: unknown; apifyAdsFetched?: unknown } | null;
        return s?.apifyRan === true || (typeof s?.apifyAdsFetched === "number" && s.apifyAdsFetched > 0);
      })
      .slice(0, 7);

    if (historicalRuns.length === 7) {
      const historicalRunIds = historicalRuns.map((run) => run.id);
      const activeCompetitors = await prisma.competitor.findMany({
        where: { active: true, socialPages: { some: { active: true } } },
        include: { socialPages: { where: { active: true } } },
      });

      for (const competitor of activeCompetitors) {
        const [historicalCount, thisRunCount, allTimeCount] = await Promise.all([
          prisma.competitorAdCapture.count({
            where: { competitorId: competitor.id, jobRunId: { in: historicalRunIds } },
          }),
          prisma.competitorAdCapture.count({
            where: { competitorId: competitor.id, jobRunId: runId },
          }),
          prisma.competitorAdCapture.count({ where: { competitorId: competitor.id } }),
        ]);

        if (historicalCount !== 0 || thisRunCount !== 0) continue;

        const hasMissingPageId = competitor.socialPages.some((page) => !page.pageId);
        if (allTimeCount === 0 && !hasMissingPageId) continue;

        summary.zeroCaptureCompetitors++;

        const dedupeKey = `store-task:zero-capture:${competitor.id}`;
        const existingTask = await prisma.storeTask.findUnique({ where: { dedupeKey } });

        await prisma.storeTask.upsert({
          where: { dedupeKey },
          create: {
            taskType: "fix_competitor_page",
            targetType: "competitor",
            targetId: competitor.id,
            title: `No ads captured for ${competitor.name} in 8 consecutive ad-library pulls`,
            description: `No Meta ads have been captured for ${competitor.name} across the last 8 Apify ad-library pulls (~8 weeks). Two possible causes: (1) the Facebook page is configured by name or URL instead of the required numeric page ID — open the page's Messenger link (facebook.com/messages/t/<id>) or Facebook's Page Transparency panel, copy the numeric ID, and set it on the competitor's social page record; or (2) the page ID is correct and the brand genuinely runs no Meta ads — verify by searching the Ad Library for the page, then dismiss this task.`,
            proposedState: json({ competitorId: competitor.id, action: "set_page_id" }),
            sourceData: json({
              historicalRunIds,
              historicalCount,
              thisRunCount,
              allTimeCount,
              missingPageIdSocialPageIds: competitor.socialPages.filter((page) => !page.pageId).map((page) => page.id),
            }),
            priority: "high",
            dedupeKey,
          },
          update: {
            taskType: "fix_competitor_page",
            targetType: "competitor",
            targetId: competitor.id,
            title: `No ads captured for ${competitor.name} in 8 consecutive ad-library pulls`,
            description: `No Meta ads have been captured for ${competitor.name} across the last 8 Apify ad-library pulls (~8 weeks). Two possible causes: (1) the Facebook page is configured by name or URL instead of the required numeric page ID — open the page's Messenger link (facebook.com/messages/t/<id>) or Facebook's Page Transparency panel, copy the numeric ID, and set it on the competitor's social page record; or (2) the page ID is correct and the brand genuinely runs no Meta ads — verify by searching the Ad Library for the page, then dismiss this task.`,
            proposedState: json({ competitorId: competitor.id, action: "set_page_id" }),
            sourceData: json({
              historicalRunIds,
              historicalCount,
              thisRunCount,
              allTimeCount,
              missingPageIdSocialPageIds: competitor.socialPages.filter((page) => !page.pageId).map((page) => page.id),
            }),
            priority: "high",
          },
        });

        if (!existingTask) {
          await sendOperatorAlert("competitor_zero_capture", {
            competitorId: competitor.id,
            competitorName: competitor.name,
            consecutiveRuns: 8,
          });
        }
      }
    }
  } catch (err) {
    errors.push(`zero_capture_watchdog: ${String(err)}`);
  }

  // Fill English translations for newly captured ad/shopping text (best-effort;
  // never fails the capture). Scraped competitor copy may be in Filipino.
  try {
    await fillCaptureTranslations({ limit: 300 });
  } catch (err) {
    errors.push(`translate_captures: ${String(err)}`);
  }

  // Classify each ad's marketing angle (best-effort; runs after translation so
  // it can use the English copy). Never fails the capture.
  try {
    await fillCreativeAngles({ limit: 300 });
  } catch (err) {
    errors.push(`classify_angles: ${String(err)}`);
  }

  summary.disabledSources = Array.from(disabledSources);
  const workDone = summary.shoppingResults + summary.competitorShoppingResults + summary.adsCaptured + summary.insightsCreated;
  const attemptedWork = summary.keywordsChecked + socialPages.length;

  const status: JobStatus = errors.length === 0 && (workDone > 0 || attemptedWork === 0)
    ? "success"
    : workDone > 0 || disabledSources.size > 0
      ? "partial"
      : "failed";
  if (status === "failed" && errors.length === 0) {
    errors.push("No market intelligence rows or insights were stored.");
  }

  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      completedAt: new Date(),
      status,
      summary: json(summary),
      errorLog: errors.length > 0 ? errors.join("\n").slice(0, 10_000) : null,
    },
  });

  return { jobName: "fetch-market-intel", runId: runId, status, summary, errors };
  } catch (err) {
    const message = String(err).slice(0, 10_000);
    errors.push(message);
    summary.disabledSources = Array.from(disabledSources);
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status: "failed",
        summary: json(summary),
        errorLog: message,
      },
    });
    return { jobName: "fetch-market-intel", runId: runId, status: "failed", summary, errors };
  }
}
