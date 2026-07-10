import { prisma } from "@/lib/db";
import {
  getGscPagesForWindow,
  getGscQueriesForWindow,
  getGscQueryPagePairsForWindow,
  getLatestGscWindow,
  getPreviousGscWindow,
  type GscWindow,
} from "@/lib/seo/gsc-normalized";
import {
  getComparisonSnapshot,
  getLatestSnapshot,
  getPages,
  getQueries,
  getSnapshotHistory,
} from "@/lib/seo/snapshot";
import { computeSnapshotTrend } from "@/lib/seo/history";
import type {
  Ga4PageRow,
  GscPageRow,
  GscQueryPageRow,
  GscQueryRow,
  SnapshotTrendPoint,
} from "@/lib/seo/types";

export type GscDataSource = "normalized" | "rawSnapshot" | "none";
export type Ga4DataSource = "normalized" | "rawSnapshot" | "none";

export interface GscFreshness {
  selectedSource: GscDataSource;
  selectedCapturedAt: Date | null;
  selectedDateRangeStart: Date | null;
  selectedDateRangeEnd: Date | null;
  normalizedCapturedAt: Date | null;
  normalizedDateRangeStart: Date | null;
  normalizedDateRangeEnd: Date | null;
  rawCapturedAt: Date | null;
  rawDateRangeStart: Date | null;
  rawDateRangeEnd: Date | null;
  fallbackReason: "normalized_missing" | "raw_newer_than_normalized" | null;
}

export interface LatestGscData {
  queries: GscQueryRow[];
  pages: GscPageRow[];
  queryPagePairs: GscQueryPageRow[];
  fetchedAt: Date | null;
  source: GscDataSource;
  window: GscWindow | null;
  freshness: GscFreshness;
}

export interface LatestGa4Data {
  pages: Ga4PageRow[];
  fetchedAt: Date | null;
  source: Ga4DataSource;
}
export interface PreviousGscData {
  queries: GscQueryRow[];
  fetchedAt: Date;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  source: Exclude<GscDataSource, "none">;
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

const RAW_NEWER_THAN_NORMALIZED_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function buildFreshness(input: {
  selectedSource: GscDataSource;
  selectedCapturedAt: Date | null;
  selectedDateRangeStart: Date | null;
  selectedDateRangeEnd: Date | null;
  normalizedWindow: GscWindow | null;
  rawSnapshot: { fetchedAt: Date; dateRangeStart: Date; dateRangeEnd: Date } | null;
  fallbackReason: GscFreshness["fallbackReason"];
}): GscFreshness {
  return {
    selectedSource: input.selectedSource,
    selectedCapturedAt: input.selectedCapturedAt,
    selectedDateRangeStart: input.selectedDateRangeStart,
    selectedDateRangeEnd: input.selectedDateRangeEnd,
    normalizedCapturedAt: input.normalizedWindow?.capturedAt ?? null,
    normalizedDateRangeStart: input.normalizedWindow?.dateRangeStart ?? null,
    normalizedDateRangeEnd: input.normalizedWindow?.dateRangeEnd ?? null,
    rawCapturedAt: input.rawSnapshot?.fetchedAt ?? null,
    rawDateRangeStart: input.rawSnapshot?.dateRangeStart ?? null,
    rawDateRangeEnd: input.rawSnapshot?.dateRangeEnd ?? null,
    fallbackReason: input.fallbackReason,
  };
}

function rawIsMateriallyNewer(rawFetchedAt: Date | null, normalizedCapturedAt: Date | null): boolean {
  if (!rawFetchedAt || !normalizedCapturedAt) return false;
  return rawFetchedAt.getTime() - normalizedCapturedAt.getTime() > RAW_NEWER_THAN_NORMALIZED_THRESHOLD_MS;
}

export async function getLatestGscData(): Promise<LatestGscData> {
  const [gscSnap, gscPagesSnap, queryPageSnap, latestWindow] = await Promise.all([
    getLatestSnapshot("gsc"),
    getLatestSnapshot("gsc_pages"),
    getLatestSnapshot("gsc_query_page"),
    getLatestGscWindow(),
  ]);

  const rawSnapshot =
    gscSnap?.fetchedAt && gscSnap?.dateRangeStart && gscSnap?.dateRangeEnd
      ? {
          fetchedAt: gscSnap.fetchedAt,
          dateRangeStart: gscSnap.dateRangeStart,
          dateRangeEnd: gscSnap.dateRangeEnd,
        }
      : null;
  const pagesRaw = gscPagesSnap?.payload?.topPages;
  const pairsRaw = queryPageSnap?.payload?.pairs;
  const rawQueries = getQueries(gscSnap);
  const rawPages = Array.isArray(pagesRaw) ? (pagesRaw as GscPageRow[]) : [];
  const rawQueryPagePairs = Array.isArray(pairsRaw) ? (pairsRaw as GscQueryPageRow[]) : [];

  if (latestWindow) {
    const [queries, pages, queryPagePairs] = await Promise.all([
      getGscQueriesForWindow(latestWindow),
      getGscPagesForWindow(latestWindow),
      getGscQueryPagePairsForWindow(latestWindow),
    ]);
    const rawIsNewer = rawIsMateriallyNewer(gscSnap?.fetchedAt ?? null, latestWindow.capturedAt);
    const shouldUseRaw = rawQueries.length > 0 && (rawIsNewer || queries.length === 0);

    if (!shouldUseRaw) {
      return {
        queries,
        pages,
        queryPagePairs,
        fetchedAt: latestWindow.capturedAt,
        source: "normalized",
        window: latestWindow,
        freshness: buildFreshness({
          selectedSource: "normalized",
          selectedCapturedAt: latestWindow.capturedAt,
          selectedDateRangeStart: latestWindow.dateRangeStart,
          selectedDateRangeEnd: latestWindow.dateRangeEnd,
          normalizedWindow: latestWindow,
          rawSnapshot,
          fallbackReason: null,
        }),
      };
    }

    return {
      queries: rawQueries,
      pages: rawPages,
      queryPagePairs: rawQueryPagePairs,
      fetchedAt: gscSnap?.fetchedAt ?? null,
      source: "rawSnapshot",
      window: null,
      freshness: buildFreshness({
        selectedSource: "rawSnapshot",
        selectedCapturedAt: gscSnap?.fetchedAt ?? null,
        selectedDateRangeStart: gscSnap?.dateRangeStart ?? null,
        selectedDateRangeEnd: gscSnap?.dateRangeEnd ?? null,
        normalizedWindow: latestWindow,
        rawSnapshot,
        fallbackReason: rawIsNewer ? "raw_newer_than_normalized" : "normalized_missing",
      }),
    };
  }

  return {
    queries: rawQueries,
    pages: rawPages,
    queryPagePairs: rawQueryPagePairs,
    fetchedAt: gscSnap?.fetchedAt ?? null,
    source: rawQueries.length ? "rawSnapshot" : "none",
    window: null,
    freshness: buildFreshness({
      selectedSource: rawQueries.length ? "rawSnapshot" : "none",
      selectedCapturedAt: rawQueries.length ? gscSnap?.fetchedAt ?? null : null,
      selectedDateRangeStart: rawQueries.length ? gscSnap?.dateRangeStart ?? null : null,
      selectedDateRangeEnd: rawQueries.length ? gscSnap?.dateRangeEnd ?? null : null,
      normalizedWindow: null,
      rawSnapshot,
      fallbackReason: rawQueries.length ? "normalized_missing" : null,
    }),
  };
}

export async function getPreviousGscQueries(current: LatestGscData): Promise<GscQueryRow[] | null> {
  return (await getPreviousGscData(current))?.queries ?? null;
}

export async function getPreviousGscData(current: LatestGscData): Promise<PreviousGscData | null> {
  if (current.source === "normalized" && current.window) {
    const previousWindow = await getPreviousGscWindow(current.window);
    if (!previousWindow) return null;
    return { queries: await getGscQueriesForWindow(previousWindow), fetchedAt: previousWindow.capturedAt, dateRangeStart: previousWindow.dateRangeStart, dateRangeEnd: previousWindow.dateRangeEnd, source: "normalized" };
  }

  const latest = await getLatestSnapshot("gsc");
  const previous = latest ? await getComparisonSnapshot("gsc", latest) : null;
  return previous?.fetchedAt && previous.dateRangeStart && previous.dateRangeEnd ? { queries: getQueries(previous), fetchedAt: previous.fetchedAt, dateRangeStart: previous.dateRangeStart, dateRangeEnd: previous.dateRangeEnd, source: "rawSnapshot" } : null;
}

export async function getLatestGa4Data(): Promise<LatestGa4Data> {
  const latestWindow = await prisma.pageAnalytics.findFirst({
    orderBy: [{ dateRangeEnd: "desc" }, { capturedAt: "desc" }],
    select: { dateRangeStart: true, dateRangeEnd: true, capturedAt: true },
  });

  if (latestWindow) {
    const rows = await prisma.pageAnalytics.findMany({
      where: {
        dateRangeStart: latestWindow.dateRangeStart,
        dateRangeEnd: latestWindow.dateRangeEnd,
      },
      orderBy: { sessions: "desc" },
      select: {
        page: true,
        sessions: true,
        bounceRate: true,
        conversionRate: true,
      },
    });
    return {
      pages: rows.map((row) => ({
        page: row.page,
        sessions: row.sessions,
        bounceRate: formatPercent(row.bounceRate),
        conversionRate: formatPercent(row.conversionRate, 2),
      })),
      fetchedAt: latestWindow.capturedAt,
      source: rows.length ? "normalized" : "none",
    };
  }

  const ga4Snap = await getLatestSnapshot("ga4");
  const pages = getPages(ga4Snap);
  return {
    pages,
    fetchedAt: ga4Snap?.fetchedAt ?? null,
    source: pages.length ? "rawSnapshot" : "none",
  };
}

export async function getSeoHistoryTrend(source = "seo_history"): Promise<SnapshotTrendPoint[]> {
  if (source === "seo_history") {
    const snapshots = await getSnapshotHistory("seo_history", 90);
    if (snapshots.length > 0) {
      return snapshots
        .map((snap) => {
          const payload = snap.payload as Partial<SnapshotTrendPoint> & {
            avgPosition?: unknown;
            ctr?: unknown;
          };
          return {
            date: snap.dateRangeEnd.toISOString(),
            clicks: Number(payload.clicks ?? 0),
            impressions: Number(payload.impressions ?? 0),
            avgPosition: Number(payload.avgPosition ?? 0),
            ctr: Number(payload.ctr ?? 0),
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return computeSnapshotTrend(await getSnapshotHistory(source));
}
