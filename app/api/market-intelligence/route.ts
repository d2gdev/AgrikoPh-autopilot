export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAppAuth, getSessionShop, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSpamStoryAd } from "@/lib/market-intel/spam-filter";
import { computeAdLongevity } from "@/lib/market-intel/ad-longevity";
import { smoothedMedian } from "@/lib/market-intel/price-signal";

type MarketIntelligencePayload = Record<string, unknown>;

const MARKET_INTELLIGENCE_CACHE_TTL_MS = 60_000;

let marketIntelligenceCache: { expiresAt: number; payload: MarketIntelligencePayload } | null = null;
let marketIntelligenceInFlight: Promise<MarketIntelligencePayload> | null = null;

async function loadMarketIntelligencePayload(forceRefresh: boolean): Promise<MarketIntelligencePayload> {
  const now = Date.now();
  if (!forceRefresh && marketIntelligenceCache && marketIntelligenceCache.expiresAt > now) {
    return marketIntelligenceCache.payload;
  }
  if (marketIntelligenceInFlight) return marketIntelligenceInFlight;

  const request = buildMarketIntelligencePayload().then((payload) => {
    const cachedPayload = {
      ...payload,
      cachedAt: new Date().toISOString(),
      cacheTtlMs: MARKET_INTELLIGENCE_CACHE_TTL_MS,
    };
    marketIntelligenceCache = {
      expiresAt: Date.now() + MARKET_INTELLIGENCE_CACHE_TTL_MS,
      payload: cachedPayload,
    };
    return cachedPayload;
  });

  marketIntelligenceInFlight = request;
  try {
    return await request;
  } finally {
    if (marketIntelligenceInFlight === request) marketIntelligenceInFlight = null;
  }
}

const ADS_PER_COMPETITOR = 15;

// Same de-noising window/tolerance the price-gap producer (jobs/fetch-market-intel.ts)
// uses for its "7d median" title text — this is a read-only display of that same
// signal, not a second source of truth, so it intentionally does not re-read the
// operator-configurable GuardrailConfig thresholds (PRICE_GAP_TASK_PCT etc.); those
// only matter for the decision to open an insight, not for showing the smoothed number.
const SMOOTHED_WINDOW_DAYS = 7;
const SMOOTHED_OUTLIER_PCT = 40;

const competitorAdSelect = {
  id: true, capturedAt: true, competitorId: true, pageName: true,
  adCopy: true, adCopyEn: true, headline: true, headlineEn: true,
  description: true, cta: true, landingPageUrl: true, adSnapshotUrl: true,
  platforms: true, startDate: true, endDate: true, activeStatus: true,
  creativeType: true, creativeAngle: true, imageUrl: true, videoUrl: true,
  // rawPayload, adArchiveId, pageId, jobRunId omitted — large/unused in UI
  competitor: { select: { id: true, name: true } },
} as const;

// Fetch the most-recently-captured ads *per competitor* rather than a single
// global "most recent N" cap — a global cap starves out competitors whose
// last capture is older than busier competitors', hiding their ads from the
// UI entirely even though they were successfully captured.
async function fetchRecentAdsPerCompetitor() {
  const competitors = await prisma.competitor.findMany({ where: { active: true }, select: { id: true } });
  const perCompetitor = await Promise.all(
    competitors.map((c) =>
      prisma.competitorAd.findMany({
        where: { competitorId: c.id },
        orderBy: { capturedAt: "desc" },
        take: ADS_PER_COMPETITOR,
        select: competitorAdSelect,
      }),
    ),
  );
  return perCompetitor.flat().sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
}

async function buildMarketIntelligencePayload(): Promise<MarketIntelligencePayload> {
  const [
    insights,
    shoppingResults,
    competitorAds,
    keywordResearch,
    activeCompetitors,
    activeKeywords,
    recentAdCaptures,
    openInsights,
    lastJobRun,
    adLongevity,
  ] = await Promise.all([
    prisma.marketInsight.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        createdAt: true,
        type: true,
        severity: true,
        title: true,
        summary: true,
        status: true,
        competitor: { select: { name: true } },
        keyword: { select: { keyword: true } },
        ad: { select: { adCopy: true, headline: true, description: true, pageName: true } },
      },
    }),
    prisma.shoppingResult.findMany({
      orderBy: { capturedAt: "desc" },
      take: 50,
      select: {
        id: true,
        capturedAt: true,
        keyword: true,
        title: true,
        titleEn: true,
        store: true,
        price: true,
        currency: true,
        searchPosition: true,
        productKey: true,
      },
    }),
    fetchRecentAdsPerCompetitor(),
    prisma.keywordResearchResult.findMany({
      orderBy: { capturedAt: "desc" },
      take: 50,
      select: {
        id: true,
        capturedAt: true,
        seedKeyword: true,
        keyword: true,
        avgMonthlySearches: true,
        competition: true,
        competitionIndex: true,
        lowTopOfPageBidMicros: true,
        highTopOfPageBidMicros: true,
      },
    }),
    prisma.competitor.count({ where: { active: true } }),
    prisma.marketKeyword.count({ where: { active: true } }),
    prisma.competitorAdCapture.count({
      where: { capturedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.marketInsight.count({
      where: { status: "open" },
    }),
    prisma.jobRun.findFirst({
      where: { jobName: "fetch-market-intel" },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        jobName: true,
        startedAt: true,
        completedAt: true,
        status: true,
      },
    }),
    computeAdLongevity(),
  ]);

  // Hide spam serialized-story creatives already stored from earlier scrapes,
  // without waiting for the next fetch-market-intel run to re-filter them.
  // No further slice here — fetchRecentAdsPerCompetitor() already bounds size
  // per-competitor; an additional global slice would re-introduce the same
  // starvation bug this replaced (busier competitors crowding out quieter ones).
  const cleanCompetitorAds = competitorAds.filter((ad) => !isSpamStoryAd(ad));

  // The "What changed" feed is built from insights; drop any insight whose
  // underlying ad is spam (keyword-search captures content-farm story ads).
  const cleanInsights = insights
    .filter((i) => !(i.ad && isSpamStoryAd(i.ad)))
    .slice(0, 25)
    .map(({ ad: _ad, ...insight }) => insight);

  // De-noised 7d-median price per shopping result, so the Price Comparison card
  // can show operators WHY a price-gap task did (or didn't) fire — the same
  // ShoppingPriceHistory series and smoothedMedian() math the price-gap
  // producer (jobs/fetch-market-intel.ts) uses, reused read-only here rather
  // than duplicated. Batched into a single query keyed by productKey instead
  // of one query per shoppingResult row.
  const now = new Date();
  const productKeys = [...new Set(shoppingResults.map((r) => r.productKey))];
  const priceHistory = productKeys.length
    ? await prisma.shoppingPriceHistory.findMany({
        where: {
          productKey: { in: productKeys },
          capturedAt: { gte: new Date(now.getTime() - SMOOTHED_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
        },
        select: { productKey: true, price: true, capturedAt: true },
      })
    : [];
  const seriesByProductKey = new Map<string, { price: number; capturedAt: Date }[]>();
  for (const point of priceHistory) {
    const series = seriesByProductKey.get(point.productKey);
    if (series) series.push(point);
    else seriesByProductKey.set(point.productKey, [point]);
  }
  const shoppingResultsWithSmoothed = shoppingResults.map(({ productKey, ...result }) => ({
    ...result,
    smoothed7d: smoothedMedian(seriesByProductKey.get(productKey) ?? [], {
      windowDays: SMOOTHED_WINDOW_DAYS,
      outlierPct: SMOOTHED_OUTLIER_PCT,
      asOf: now,
    }),
  }));

  return {
    insights: cleanInsights,
    shoppingResults: shoppingResultsWithSmoothed,
    competitorAds: cleanCompetitorAds,
    // BigInt columns (bid micros) cannot be serialized by JSON.stringify — cast to string.
    // The client already parses these via Number(...).
    keywordResearch: keywordResearch.map((row) => ({
      ...row,
      lowTopOfPageBidMicros: row.lowTopOfPageBidMicros?.toString() ?? null,
      highTopOfPageBidMicros: row.highTopOfPageBidMicros?.toString() ?? null,
    })),
    stats: {
      activeCompetitors,
      activeKeywords,
      recentAdCaptures,
      openInsights,
    },
    lastJobRun,
    adLongevity,
  };
}

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  try {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    if (forceRefresh) {
      const actor = (await getSessionShop(req)) ?? (await getSessionUser(req)) ?? "embedded-app";
      if (!checkRateLimit(`market-intelligence-refresh:${actor}`, 10, 60_000)) {
        return NextResponse.json({ error: "Rate limit exceeded — max 10 refreshes per minute" }, { status: 429 });
      }
    }
    return NextResponse.json(await loadMarketIntelligencePayload(forceRefresh));
  } catch (error) {
    // Always return a JSON body so the client surfaces the real cause instead of
    // failing on an empty-body 500 ("Unexpected end of JSON input").
    console.error("[market-intelligence] GET failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load market intelligence" },
      { status: 500 },
    );
  }
}
