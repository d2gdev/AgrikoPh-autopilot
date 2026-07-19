export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSessionShop, requireAppAuth } from "@/lib/auth";
import { computeTrends } from "@/lib/seo/trends";
import { computeCtrOpportunities } from "@/lib/seo/opportunities";
import { computeOpportunityClusters } from "@/lib/seo/clusters";
import { computePageHealth, normalizePagePath } from "@/lib/seo/page-health";
import { parsePercent } from "@/lib/seo/types";
import { getLatestGa4Data, getLatestGscData, getPreviousGscData, getPreviousGscQueries } from "@/lib/seo/data";
import { prisma } from "@/lib/db";

type SeoSummaryPayload = {
  topQueries: unknown[];
  topPages: unknown[];
  gscFetchedAt: Date | null;
  ga4FetchedAt: Date | null;
  dataSource: {
    gsc: "normalized" | "rawSnapshot" | "none";
    ga4: "normalized" | "rawSnapshot" | "none";
  };
  gscFreshness: Awaited<ReturnType<typeof getLatestGscData>>["freshness"];
  ga4Freshness: Awaited<ReturnType<typeof getLatestGa4Data>>["freshness"];
  cachedAt?: string;
  cacheTtlMs?: number;
};

const SEO_SUMMARY_CACHE_TTL_MS = 60_000;

let seoSummaryCache: { expiresAt: number; limit: number; shop: string; payload: SeoSummaryPayload } | null = null;

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  const shop = (await getSessionShop(req)) ?? "unknown-shop";
  try {
    const url = new URL(req.url);
    const view = url.searchParams.get("view");
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const limit = Math.max(
      1,
      Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50),
    );
    // Cache key must include `limit` — it's a real, client-controllable param
    // that changes the payload shape. Keying on `view` alone meant a request
    // for one limit could serve another caller's cached, differently-sized
    // payload within the 60s TTL.
    if (
      view === "summary" &&
      !forceRefresh &&
      seoSummaryCache &&
      seoSummaryCache.shop === shop &&
      seoSummaryCache.limit === limit &&
      seoSummaryCache.expiresAt > Date.now()
    ) {
      return NextResponse.json(seoSummaryCache.payload);
    }

    const [gscData, ga4Data] = await Promise.all([
      getLatestGscData(),
      getLatestGa4Data(),
    ]);
    const queries = gscData.queries;
    const topPages = ga4Data.pages;

    if (view === "summary") {
      const top = queries.slice(0, limit);
      // Attach cached DataForSEO monthly search volume ("Traffic" column).
      // Read-only join — the cache is populated by the GSC fetch job, so a
      // passive page view never calls the metered DataForSEO API.
      const volumeKeys = Array.from(
        new Set(top.map((q) => (q.query ?? "").trim().toLowerCase()).filter((k) => k.length > 0)),
      );
      const volumeByKey = new Map<string, number>();
      if (volumeKeys.length) {
        const vols = await prisma.keywordSearchVolume.findMany({
          where: { keyword: { in: volumeKeys } },
          select: { keyword: true, searchVolume: true },
        });
        for (const v of vols) volumeByKey.set(v.keyword, v.searchVolume);
      }
      const topWithVolume = top.map((q) => ({
        ...q,
        searchVolume: volumeByKey.get((q.query ?? "").trim().toLowerCase()) ?? null,
      }));

      const payload: SeoSummaryPayload = {
        topQueries: topWithVolume,
        topPages: topPages.slice(0, limit),
        gscFetchedAt: gscData.fetchedAt,
        ga4FetchedAt: ga4Data.fetchedAt,
        dataSource: {
          gsc: gscData.source,
          ga4: ga4Data.source,
        },
        gscFreshness: gscData.freshness,
        ga4Freshness: ga4Data.freshness,
        cachedAt: new Date().toISOString(),
        cacheTtlMs: SEO_SUMMARY_CACHE_TTL_MS,
      };
      seoSummaryCache = { expiresAt: Date.now() + SEO_SUMMARY_CACHE_TTL_MS, limit, shop, payload };
      return NextResponse.json(payload);
    }

    const previous = getPreviousGscData
      ? await getPreviousGscData(gscData)
      : ((await getPreviousGscQueries(gscData))
          ? {
              queries: await getPreviousGscQueries(gscData),
              fetchedAt: new Date(0),
              propertyTotals: null,
            }
          : null);
    const trends = computeTrends(
      queries,
      previous?.queries ?? null,
      gscData.fetchedAt?.toISOString() ?? null,
      previous?.fetchedAt.toISOString() ?? null,
      gscData.propertyTotals,
      previous?.propertyTotals ?? null,
    );
    const gscPages = gscData.pages;
    const allQueryPagePairs = gscData.queryPagePairs;
    const topQueries = queries;

    // Build keyword-research lookup: latest row per keyword, keyed by
    // normalized (trim+lowercase) keyword. Bounded to the queries we actually
    // surface so the lookup stays small even if the table grows large.
    const queryKeys = Array.from(
      new Set(
        queries
          .map((q) => (q.query ?? "").trim().toLowerCase())
          .filter((k) => k.length > 0),
      ),
    );
    const research = new Map<
      string,
      { avgMonthlySearches: number | null; competitionIndex: number | null }
    >();
    if (queryKeys.length) {
      const rows = await prisma.keywordResearchResult.findMany({
        where: { keyword: { in: queryKeys } },
        orderBy: { capturedAt: "desc" },
      });
      for (const r of rows) {
        const key = (r.keyword ?? "").trim().toLowerCase();
        if (!key || research.has(key)) continue; // first = latest
        research.set(key, {
          avgMonthlySearches: r.avgMonthlySearches ?? null,
          competitionIndex: r.competitionIndex ?? null,
        });
      }
    }

    // Build per-page GA4 conversion lookup: normalized path → conversionRate as
    // a fraction (GA4 stores it as a percent string; parsePercent → fraction).
    const pageConversion = new Map<string, number>();
    for (const g of topPages) {
      if (!g || !g.page) continue;
      const key = normalizePagePath(g.page);
      if (!key) continue;
      pageConversion.set(key, parsePercent(g.conversionRate));
    }

    const opportunities = computeCtrOpportunities(
      queries,
      allQueryPagePairs,
      research,
      pageConversion,
    );
    const queryPagePairs = allQueryPagePairs.slice(0, 50);
    const clusters = computeOpportunityClusters(opportunities);

    const pageHealth = computePageHealth(gscPages, topPages);

    return NextResponse.json({
      topQueries,
      topPages,
      gscPages,
      queryPagePairs,
      limits: {
        queryPagePairsTotal: allQueryPagePairs.length,
        queryPagePairsReturned: queryPagePairs.length,
        queryPagePairsTruncated: allQueryPagePairs.length > queryPagePairs.length,
      },
      gscFetchedAt: gscData.fetchedAt,
      ga4FetchedAt: ga4Data.fetchedAt,
      dataSource: {
        gsc: gscData.source,
        ga4: ga4Data.source,
      },
      gscFreshness: gscData.freshness,
      ga4Freshness: ga4Data.freshness,
      trends,
      opportunities,
      clusters,
      pageHealth,
    });
  } catch (err) {
    console.error("[seo] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
