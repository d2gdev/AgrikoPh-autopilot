export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth } from "@/lib/auth";
import { buildArticleSessionMap } from "@/lib/seo/page-analytics";

export async function GET(req: Request) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;
  try {
    const [articleRecords, latestPageAnalyticsWindow, ga4Snap] = await Promise.all([
      prisma.articleRecord.findMany({
        orderBy: { indexedAt: "desc" },
        take: 200,
        select: {
          shopifyId: true,
          handle: true,
          title: true,
          publishedAt: true,
          wordCount: true,
          seoData: true,
          indexedAt: true,
        },
      }),
      prisma.pageAnalytics.findFirst({
        orderBy: [{ dateRangeEnd: "desc" }, { capturedAt: "desc" }],
        select: { dateRangeStart: true, dateRangeEnd: true, capturedAt: true },
      }),
      prisma.rawSnapshot.findFirst({ where: { source: "ga4" }, orderBy: { fetchedAt: "desc" } }),
    ]);

    // Shape records to match the BlogArticle interface expected by the frontend
    const articles = articleRecords.map((r) => {
      const seo = r.seoData as { title?: string; description?: string } | null;
      return {
        id: r.shopifyId,
        title: r.title,
        handle: r.handle,
        blogTitle: "",
        publishedAt: r.publishedAt?.toISOString() ?? null,
        authorName: "",
        tags: [] as string[],
        seoTitle: seo?.title ?? null,
        seoDescription: seo?.description ?? null,
        bodySummary: "",
        bodyHtml: "",
        onlineStoreUrl: null,
      };
    });

    let trafficMap: Record<string, number> = {};
    let pageAnalyticsFetchedAt: Date | null = null;
    if (latestPageAnalyticsWindow) {
      const pageRows = await prisma.pageAnalytics.findMany({
        where: {
          dateRangeStart: latestPageAnalyticsWindow.dateRangeStart,
          dateRangeEnd: latestPageAnalyticsWindow.dateRangeEnd,
        },
        select: { page: true, sessions: true },
      });
      trafficMap = buildArticleSessionMap(pageRows);
      pageAnalyticsFetchedAt = latestPageAnalyticsWindow.capturedAt;
    }

    // Fallback for pre-migration databases where PageAnalytics is not populated yet.
    if (Object.keys(trafficMap).length === 0) {
      const ga4Payload = (ga4Snap?.payload as Record<string, unknown>) ?? {};
      const topPages = (ga4Payload.topPages as Array<{ page: string; sessions: number }>) ?? [];
      trafficMap = buildArticleSessionMap(topPages);
    }

    const enriched = articles.map((a) => ({
      ...a,
      sessions: trafficMap[a.handle] ?? 0,
    }));

    // Sort by traffic desc, then by date
    enriched.sort((a, b) => (b.sessions - a.sessions) || (new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()));

    return NextResponse.json({
      articles: enriched,
      total: enriched.length,
      ga4FetchedAt: ga4Snap?.fetchedAt ?? null,
      pageAnalyticsFetchedAt,
    });
  } catch (err) {
    console.error("[content-pilot] articles error:", err);
    return NextResponse.json({ error: "Internal server error", articles: [], total: 0 }, { status: 500 });
  }
}
