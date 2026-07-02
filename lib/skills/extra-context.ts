import { prisma } from "@/lib/db";
import type { ExtraSource } from "@/lib/skills/loader";
import type { GscQueryRow, Ga4PageRow } from "@/lib/seo/types";

const MARKET_INTEL_WINDOW_DAYS = 30;
const PRICE_HISTORY_WINDOW_DAYS = 14;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Shape of rows in the gsc_query_page snapshot payload (`payload.pairs`) —
// see lib/connectors/gsc.ts fetchGscQueryPageData.
type GscQueryPagePair = {
  query?: string;
  page?: string;
  clicks?: number;
  impressions?: number;
  position?: string;
};

async function buildGscContext(): Promise<unknown> {
  let snap = await prisma.rawSnapshot.findFirst({
    where: { source: "gsc" },
    orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
  });
  let queries: Array<Partial<GscQueryRow>> = [];

  if (snap) {
    const payload = snap.payload as Record<string, unknown> | null;
    queries = Array.isArray(payload?.topQueries) ? (payload!.topQueries as GscQueryRow[]) : [];
  } else {
    snap = await prisma.rawSnapshot.findFirst({
      where: { source: "gsc_query_page" },
      orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
    });
    if (!snap) return null;
    // gsc_query_page payload shape is { pairs, fetchedAt } (see lib/connectors/gsc.ts) —
    // map pair rows into the same top-queries shape the primary path emits.
    const payload = snap.payload as Record<string, unknown> | null;
    const pairs = Array.isArray(payload?.pairs) ? (payload!.pairs as GscQueryPagePair[]) : [];
    queries = pairs.map((p) => ({
      query: p.query ?? "",
      clicks: p.clicks ?? 0,
      impressions: p.impressions ?? 0,
      position: p.position ?? "",
    }));
  }

  const topQueries = [...queries]
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
    .slice(0, 100);

  return {
    dateRangeStart: snap.dateRangeStart,
    dateRangeEnd: snap.dateRangeEnd,
    topQueries,
  };
}

async function buildGa4Context(): Promise<unknown> {
  const snap = await prisma.rawSnapshot.findFirst({
    where: { source: "ga4" },
    orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
  });
  if (!snap) return null;

  const payload = snap.payload as Record<string, unknown> | null;
  const pages = Array.isArray(payload?.topPages) ? (payload!.topPages as Ga4PageRow[]) : [];
  const topLandingPages = [...pages]
    .sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0))
    .slice(0, 50);

  return {
    dateRangeStart: snap.dateRangeStart,
    dateRangeEnd: snap.dateRangeEnd,
    topLandingPages,
  };
}

async function buildMarketIntelContext(): Promise<unknown> {
  const [competitorAds, priceChanges, marketInsights] = await Promise.all([
    prisma.competitorAd.findMany({
      where: {
        activeStatus: "ACTIVE",
        createdAt: { gte: daysAgo(MARKET_INTEL_WINDOW_DAYS) },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { competitor: true },
    }),
    prisma.shoppingPriceHistory.findMany({
      where: {
        capturedAt: { gte: daysAgo(PRICE_HISTORY_WINDOW_DAYS) },
        priceDelta: { not: null },
      },
      orderBy: { capturedAt: "desc" },
      take: 20,
    }),
    prisma.marketInsight.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    competitorAds: competitorAds.map((ad) => ({
      competitor: ad.competitor?.name ?? null,
      headline: ad.headline ?? null,
      adCopy: ad.adCopy ? ad.adCopy.slice(0, 200) : null,
      cta: ad.cta ?? null,
      startDate: ad.startDate,
      activeStatus: ad.activeStatus ?? null,
    })),
    priceChanges: priceChanges.map((p) => ({
      productKey: p.productKey,
      title: p.title,
      store: p.store ?? null,
      price: p.price,
      previousPrice: p.previousPrice ?? null,
      priceDelta: p.priceDelta ?? null,
      priceDeltaPct: p.priceDeltaPct ?? null,
      capturedAt: p.capturedAt,
    })),
    marketInsights: marketInsights.map((m) => ({
      type: m.type,
      severity: m.severity,
      title: m.title,
      summary: m.summary,
    })),
  };
}

async function buildKeywordResearchContext(): Promise<unknown> {
  const rows = await prisma.keywordResearchResult.findMany({
    orderBy: { capturedAt: "desc" },
    take: 50,
  });

  return rows.map((r) => ({
    keyword: r.keyword,
    avgMonthlySearches: r.avgMonthlySearches ?? null,
    competition: r.competition ?? null,
    lowTopOfPageBidMicros: r.lowTopOfPageBidMicros !== null && r.lowTopOfPageBidMicros !== undefined
      ? r.lowTopOfPageBidMicros.toString()
      : null,
    highTopOfPageBidMicros: r.highTopOfPageBidMicros !== null && r.highTopOfPageBidMicros !== undefined
      ? r.highTopOfPageBidMicros.toString()
      : null,
  }));
}

const BUILDERS: Record<ExtraSource, () => Promise<unknown>> = {
  gsc: buildGscContext,
  ga4: buildGa4Context,
  market_intel: buildMarketIntelContext,
  keyword_research: buildKeywordResearchContext,
};

/**
 * Loads extra (non-ad-snapshot) context for the given sources. Read-only,
 * latest-window, size-capped per source. Missing data for a source resolves
 * to `null` rather than throwing — skills must tolerate absence.
 */
export async function buildExtraContext(sources: string[]): Promise<Record<string, unknown>> {
  const unique = Array.from(new Set(sources)).filter(
    (s): s is ExtraSource => Object.prototype.hasOwnProperty.call(BUILDERS, s)
  );

  const context: Record<string, unknown> = {};
  await Promise.all(
    unique.map(async (source) => {
      try {
        context[source] = await BUILDERS[source]();
      } catch (err) {
        console.warn(`[skills/extra-context] Failed to build context for source "${source}":`, err);
        context[source] = null;
      }
    })
  );
  return context;
}
