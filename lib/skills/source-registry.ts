import { prisma } from "@/lib/db";
import type { JobResult } from "@/lib/jobs/types";
import type { SkillDataSource } from "@/lib/skills/loader";

export type SourceState = "fresh" | "stale" | "missing" | "disabled" | "error";

export type SourceStatus = {
  source: SkillDataSource;
  state: SourceState;
  latestAt: Date | null;
  evidenceId?: string;
  rowCount?: number;
  reason?: string;
};

export type SourceRefreshResult = {
  attempted: boolean;
  status: "success" | "partial" | "failed" | "skipped";
  errors: string[];
};

type BaseSnapshot = { id: string; source: string; payload: unknown };

type MarketEvidenceSnapshot = {
  id: string;
  source: string;
  payload: unknown;
  fetchedAt: Date;
  dateRangeEnd?: Date | null;
};

const RAW_SNAPSHOT_SOURCE: Partial<Record<SkillDataSource, string>> = {
  gsc: "gsc",
  gsc_query_page: "gsc_query_page",
  ga4: "ga4",
  dataforseo_ranked: "dataforseo_ranked",
  shopify_catalog: "shopify_catalog",
  shopify_orders: "shopify_orders",
};

const MARKET_INTEL_BASE_SOURCES = [
  "dataforseo_ranked",
  "dataforseo_keyword_gap",
  "shopify_catalog",
] as const;

function isFresh(latestAt: Date | null, freshnessHours: number): boolean {
  if (!latestAt) return false;
  return Date.now() - latestAt.getTime() <= freshnessHours * 60 * 60 * 1000;
}

function snapshotOrderBy() {
  return [{ dateRangeEnd: "desc" as const }, { fetchedAt: "desc" as const }];
}

function latestSnapshotMoment(snapshot?: { fetchedAt?: Date | null; dateRangeEnd?: Date | null } | null) {
  return snapshot?.dateRangeEnd ?? snapshot?.fetchedAt ?? null;
}

function countRows(source: SkillDataSource, payload: unknown): number | undefined {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  if (source === "gsc" && Array.isArray(record.topQueries)) return record.topQueries.length;
  if (source === "gsc_query_page" && Array.isArray(record.pairs)) return record.pairs.length;
  if (source === "ga4" && Array.isArray(record.topPages)) return record.topPages.length;
  if (source === "dataforseo_ranked" && Array.isArray(record.topQueries)) return record.topQueries.length;
  if (source === "shopify_orders" && Array.isArray(record.orders)) return record.orders.length;
  if (source === "shopify_catalog" && Array.isArray(record.products)) return record.products.length;
  if (source === "keyword_research" && Array.isArray(record.keywords)) return record.keywords.length;
  if (Array.isArray(record.items)) return record.items.length;

  return undefined;
}

async function getRawSnapshot(source: string): Promise<{
  id: string;
  source: string;
  payload: unknown;
  fetchedAt: Date;
  dateRangeEnd?: Date | null;
} | null> {
  return prisma.rawSnapshot.findFirst({
    where: { source },
    orderBy: snapshotOrderBy(),
    select: {
      id: true,
      source: true,
      payload: true,
      fetchedAt: true,
      dateRangeEnd: true,
    },
  });
}

function countRowsForSnapshotSource(snapshotSource: string, payload: unknown): number | undefined {
  if (snapshotSource === "dataforseo_ranked") return countRows("dataforseo_ranked", payload);
  if (snapshotSource === "shopify_catalog") return countRows("shopify_catalog", payload);
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  if (snapshotSource === "dataforseo_keyword_gap" && Array.isArray(record.intersections)) {
    return record.intersections.length;
  }

  return undefined;
}

function refreshResultFromJobResult(result: Pick<JobResult, "errors"> & { status: string }): SourceRefreshResult {
  const status = result.status === "success" || result.status === "partial" || result.status === "failed" || result.status === "skipped"
    ? result.status
    : "failed";

  return {
    attempted: true,
    status,
    errors: result.errors,
  };
}

async function refreshSeo(): Promise<SourceRefreshResult> {
  try {
    const { fetchSeoDataHandler } = await import("@/jobs/fetch-seo-data");
    return refreshResultFromJobResult(await fetchSeoDataHandler());
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshKeywordResearch(): Promise<SourceRefreshResult> {
  try {
    const { fetchKeywordResearchHandler } = await import("@/jobs/fetch-keyword-research");
    return refreshResultFromJobResult(await fetchKeywordResearchHandler());
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshBlog(): Promise<SourceRefreshResult> {
  try {
    const { fetchBlogContentHandler } = await import("@/jobs/fetch-blog-content");
    return refreshResultFromJobResult(await fetchBlogContentHandler());
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshMarketIntel(): Promise<SourceRefreshResult> {
  try {
    const { fetchMarketIntelHandler } = await import("@/jobs/fetch-market-intel");
    return refreshResultFromJobResult(await fetchMarketIntelHandler({ profile: "smoke" }));
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function refreshOrders(): Promise<SourceRefreshResult> {
  try {
    const { fetchOrdersHandler } = await import("@/jobs/fetch-orders");
    return refreshResultFromJobResult(await fetchOrdersHandler());
  } catch (err) {
    return { attempted: true, status: "failed", errors: [String(err)] };
  }
}

async function checkRawSnapshotSource(source: SkillDataSource, snapshotSource: string, freshnessHours: number): Promise<SourceStatus> {
  const snapshot = await getRawSnapshot(snapshotSource);
  if (!snapshot) {
    return {
      source,
      state: "missing",
      latestAt: null,
      reason: `no ${snapshotSource} snapshot found`,
    };
  }

  const latestAt = latestSnapshotMoment(snapshot);
  return {
    source,
    state: isFresh(latestAt, freshnessHours) ? "fresh" : "stale",
    latestAt,
    evidenceId: snapshot.id,
    rowCount: countRows(source, snapshot.payload),
  };
}

async function checkKeywordResearchStatus(freshnessHours: number): Promise<SourceStatus> {
  const latest = await prisma.keywordResearchResult.findFirst({
    orderBy: { capturedAt: "desc" },
    select: {
      id: true,
      capturedAt: true,
    },
  });
  const rowCount = await prisma.keywordResearchResult.count();

  if (!latest) {
    return {
      source: "keyword_research",
      state: "missing",
      latestAt: null,
      rowCount,
      reason: "no keyword research rows found",
    };
  }

  return {
    source: "keyword_research",
    state: isFresh(latest.capturedAt, freshnessHours) ? "fresh" : "stale",
    latestAt: latest.capturedAt,
    evidenceId: latest.id,
    rowCount,
    reason: "keyword research is table-backed",
  };
}

async function checkBlogStatus(freshnessHours: number): Promise<SourceStatus> {
  const latest = await prisma.articleSnapshot.findFirst({
    orderBy: { capturedAt: "desc" },
    select: {
      id: true,
      capturedAt: true,
    },
  });
  const rowCount = await prisma.articleSnapshot.count();

  if (!latest) {
    return {
      source: "blog",
      state: "missing",
      latestAt: null,
      rowCount,
      reason: "no article snapshots found",
    };
  }

  return {
    source: "blog",
    state: isFresh(latest.capturedAt, freshnessHours) ? "fresh" : "stale",
    latestAt: latest.capturedAt,
    evidenceId: latest.id,
    rowCount,
    reason: "blog content is tracked via article snapshots",
  };
}

async function checkMarketIntelStatus(freshnessHours: number): Promise<SourceStatus> {
  const latestInsight = await prisma.marketInsight.findFirst({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
    },
  });
  const rowCount = await prisma.marketInsight.count({
    where: { status: "open" },
  });

  if (latestInsight) {
    return {
      source: "market_intel",
      state: isFresh(latestInsight.createdAt, freshnessHours) ? "fresh" : "stale",
      latestAt: latestInsight.createdAt,
      evidenceId: latestInsight.id,
      rowCount,
      reason: "market intelligence uses open MarketInsight rows as evidence",
    };
  }

  const marketSnapshots = (await Promise.all(MARKET_INTEL_BASE_SOURCES.map((source) => getRawSnapshot(source))))
    .filter((snapshot): snapshot is MarketEvidenceSnapshot => snapshot !== null);

  if (marketSnapshots.length === 0) {
    return {
      source: "market_intel",
      state: "missing",
      latestAt: null,
      rowCount,
      reason: "no open market insights or market evidence snapshots found",
    };
  }

  marketSnapshots.sort((a, b) => {
    const aTime = latestSnapshotMoment(a)?.getTime() ?? 0;
    const bTime = latestSnapshotMoment(b)?.getTime() ?? 0;
    return bTime - aTime;
  });

  const latestSnapshot = marketSnapshots[0];
  if (!latestSnapshot) {
    return {
      source: "market_intel",
      state: "missing",
      latestAt: null,
      rowCount,
      reason: "no open market insights or market evidence snapshots found",
    };
  }
  const latestAt = latestSnapshotMoment(latestSnapshot);

  return {
    source: "market_intel",
    state: isFresh(latestAt, freshnessHours) ? "fresh" : "stale",
    latestAt,
    evidenceId: latestSnapshot.id,
    rowCount: countRowsForSnapshotSource(latestSnapshot.source, latestSnapshot.payload),
    reason: `market intelligence is using ${latestSnapshot.source} snapshot evidence`,
  };
}

export async function checkSourceStatus(source: SkillDataSource, freshnessHours = 72): Promise<SourceStatus> {
  if (source === "keyword_research") return checkKeywordResearchStatus(freshnessHours);
  if (source === "market_intel") return checkMarketIntelStatus(freshnessHours);
  if (source === "blog") return checkBlogStatus(freshnessHours);

  const snapshotSource = RAW_SNAPSHOT_SOURCE[source];
  if (!snapshotSource) {
    return {
      source,
      state: "error",
      latestAt: null,
      reason: `no source registry rule for ${source}`,
    };
  }

  return checkRawSnapshotSource(source, snapshotSource, freshnessHours);
}

export async function refreshSourcesOnce(sources: SkillDataSource[]): Promise<Record<string, SourceRefreshResult>> {
  const unique = Array.from(new Set(sources));
  const result: Record<string, SourceRefreshResult> = {};
  const needsSeo = unique.some((source) => source === "gsc" || source === "gsc_query_page" || source === "ga4");
  const needsMarket = unique.some(
    (source) => source === "market_intel" || source === "dataforseo_ranked" || source === "shopify_catalog",
  );

  if (needsSeo) {
    const refreshed = await refreshSeo();
    for (const source of unique.filter((value) => value === "gsc" || value === "gsc_query_page" || value === "ga4")) {
      result[source] = refreshed;
    }
  }

  if (needsMarket) {
    const refreshed = await refreshMarketIntel();
    for (const source of unique.filter(
      (value) => value === "market_intel" || value === "dataforseo_ranked" || value === "shopify_catalog",
    )) {
      result[source] = refreshed;
    }
  }

  if (unique.includes("blog")) result.blog = await refreshBlog();
  if (unique.includes("keyword_research")) result.keyword_research = await refreshKeywordResearch();
  if (unique.includes("shopify_orders")) result.shopify_orders = await refreshOrders();

  for (const source of unique) {
    result[source] ??= {
      attempted: false,
      status: "skipped",
      errors: [`no refresh configured for ${source}`],
    };
  }

  return result;
}

export async function selectBaseSnapshotForSource(source: SkillDataSource): Promise<BaseSnapshot | null> {
  if (source === "market_intel") {
    const candidates = (await Promise.all(MARKET_INTEL_BASE_SOURCES.map((candidate) => getRawSnapshot(candidate))))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aTime = latestSnapshotMoment(a)?.getTime() ?? 0;
      const bTime = latestSnapshotMoment(b)?.getTime() ?? 0;
      return bTime - aTime;
    });

    const latestSnapshot = candidates[0];
    if (!latestSnapshot) return null;

    return {
      id: latestSnapshot.id,
      source: latestSnapshot.source,
      payload: latestSnapshot.payload,
    };
  }

  if (source === "blog") {
    const latest = await prisma.articleSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      select: {
        id: true,
        handle: true,
        title: true,
        seoData: true,
        linksData: true,
        topicsData: true,
        capturedAt: true,
      },
    });

    if (!latest) return null;

    return {
      id: latest.id,
      source: "blog",
      payload: {
        handle: latest.handle,
        title: latest.title,
        seoData: latest.seoData,
        linksData: latest.linksData,
        topicsData: latest.topicsData,
        capturedAt: latest.capturedAt,
      },
    };
  }

  if (source === "keyword_research") {
    const snapshot = await getRawSnapshot("keyword_research");
    if (snapshot) {
      return {
        id: snapshot.id,
        source: snapshot.source,
        payload: snapshot.payload,
      };
    }

    const rows = await prisma.keywordResearchResult.findMany({
      orderBy: [{ capturedAt: "desc" }, { keyword: "asc" }],
      take: 100,
      select: {
        id: true,
        keyword: true,
        seedKeyword: true,
        source: true,
        avgMonthlySearches: true,
        competition: true,
        lowTopOfPageBidMicros: true,
        highTopOfPageBidMicros: true,
        capturedAt: true,
        rawPayload: true,
      },
    });

    if (rows.length === 0) return null;

    return {
      id: "keyword-research-fallback",
      source: "keyword_research",
      payload: {
        keywords: rows.map((row) => ({
          id: row.id,
          keyword: row.keyword,
          seedKeyword: row.seedKeyword,
          source: row.source,
          avgMonthlySearches: row.avgMonthlySearches,
          competition: row.competition,
          capturedAt: row.capturedAt,
          lowTopOfPageBidMicros:
            row.lowTopOfPageBidMicros !== null && row.lowTopOfPageBidMicros !== undefined
              ? row.lowTopOfPageBidMicros.toString()
              : null,
          highTopOfPageBidMicros:
            row.highTopOfPageBidMicros !== null && row.highTopOfPageBidMicros !== undefined
              ? row.highTopOfPageBidMicros.toString()
              : null,
          rawPayload: row.rawPayload,
        })),
      },
    };
  }

  const snapshotSource = RAW_SNAPSHOT_SOURCE[source];
  if (!snapshotSource) return null;

  const snapshot = await prisma.rawSnapshot.findFirst({
    where: { source: snapshotSource },
    orderBy: snapshotOrderBy(),
    select: { id: true, source: true, payload: true },
  });

  if (!snapshot) return null;

  return snapshot;
}
