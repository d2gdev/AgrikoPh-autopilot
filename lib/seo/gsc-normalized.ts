import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { GscPageRow, GscQueryPageRow, GscQueryRow } from "@/lib/seo/types";

type GscClient = Pick<PrismaClient, "gscQuery">;

export interface GscWindow {
  dateRangeStart: Date;
  dateRangeEnd: Date;
  capturedAt: Date;
}

interface GscQueryRecord {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number | null;
  ctr: number | null;
}

interface Aggregate {
  clicks: number;
  impressions: number;
  weightedPosition: number;
  positionedImpressions: number;
}

function clientOrDefault(client?: GscClient): GscClient {
  return client ?? prisma;
}

function windowWhere(window: GscWindow) {
  return {
    dateRangeStart: window.dateRangeStart,
    dateRangeEnd: window.dateRangeEnd,
    capturedAt: window.capturedAt,
  };
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function position(value: number): string {
  return value.toFixed(1);
}

function addAggregate(map: Map<string, Aggregate>, key: string, row: GscQueryRecord): void {
  const current = map.get(key) ?? {
    clicks: 0,
    impressions: 0,
    weightedPosition: 0,
    positionedImpressions: 0,
  };
  current.clicks += row.clicks;
  current.impressions += row.impressions;
  if (row.position != null && row.impressions > 0) {
    current.weightedPosition += row.position * row.impressions;
    current.positionedImpressions += row.impressions;
  }
  map.set(key, current);
}

function aggregatePosition(agg: Aggregate): number {
  return agg.positionedImpressions > 0 ? agg.weightedPosition / agg.positionedImpressions : 0;
}

async function rowsForWindow(
  window: GscWindow,
  client?: GscClient,
): Promise<GscQueryRecord[]> {
  return clientOrDefault(client).gscQuery.findMany({
    where: windowWhere(window),
    select: {
      query: true,
      page: true,
      clicks: true,
      impressions: true,
      position: true,
      ctr: true,
    },
  });
}

export async function getLatestGscWindow(client?: GscClient): Promise<GscWindow | null> {
  const row = await clientOrDefault(client).gscQuery.findFirst({
    select: { dateRangeStart: true, dateRangeEnd: true, capturedAt: true },
    orderBy: [{ dateRangeEnd: "desc" }, { capturedAt: "desc" }],
  });
  return row;
}

export async function getPreviousGscWindow(
  latest: GscWindow,
  client?: GscClient,
): Promise<GscWindow | null> {
  const rows = await clientOrDefault(client).gscQuery.findMany({
    where: {
      dateRangeEnd: { lt: latest.dateRangeStart },
    },
    select: { dateRangeStart: true, dateRangeEnd: true, capturedAt: true },
    orderBy: [{ dateRangeEnd: "desc" }, { capturedAt: "desc" }],
    take: 30,
  });
  const durationMs = latest.dateRangeEnd.getTime() - latest.dateRangeStart.getTime();
  return rows.find((row) => row.dateRangeEnd.getTime() - row.dateRangeStart.getTime() === durationMs) ?? null;
}

export async function getGscQueriesForWindow(
  window: GscWindow,
  client?: GscClient,
): Promise<GscQueryRow[]> {
  return aggregateQueries(await rowsForWindow(window, client));
}

function aggregateQueries(rows: GscQueryRecord[]): GscQueryRow[] {
  const grouped = new Map<string, Aggregate>();

  for (const row of rows) {
    if (!row.query) continue;
    addAggregate(grouped, row.query, row);
  }

  return [...grouped.entries()]
    .map(([query, agg]) => ({
      query,
      clicks: agg.clicks,
      impressions: agg.impressions,
      ctr: percent(agg.impressions > 0 ? agg.clicks / agg.impressions : 0),
      position: position(aggregatePosition(agg)),
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export async function getGscPagesForWindow(
  window: GscWindow,
  client?: GscClient,
): Promise<GscPageRow[]> {
  return aggregatePages(await rowsForWindow(window, client));
}

function aggregatePages(rows: GscQueryRecord[]): GscPageRow[] {
  const grouped = new Map<string, Aggregate>();

  for (const row of rows) {
    if (!row.page) continue;
    addAggregate(grouped, row.page, row);
  }

  return [...grouped.entries()]
    .map(([page, agg]) => ({
      page,
      clicks: agg.clicks,
      impressions: agg.impressions,
      ctr: percent(agg.impressions > 0 ? agg.clicks / agg.impressions : 0),
      position: position(aggregatePosition(agg)),
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export async function getGscQueryPagePairsForWindow(
  window: GscWindow,
  client?: GscClient,
): Promise<GscQueryPageRow[]> {
  return aggregateQueryPagePairs(await rowsForWindow(window, client));
}

function aggregateQueryPagePairs(rows: GscQueryRecord[]): GscQueryPageRow[] {
  return rows
    .filter((row) => row.query && row.page)
    .map((row) => ({
      query: row.query,
      page: row.page,
      clicks: row.clicks,
      impressions: row.impressions,
      position: position(row.position ?? 0),
    }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
}

export async function getGscDataForWindow(
  window: GscWindow,
  client?: GscClient,
): Promise<{ queries: GscQueryRow[]; pages: GscPageRow[]; queryPagePairs: GscQueryPageRow[] }> {
  const rows = await rowsForWindow(window, client);
  return {
    queries: aggregateQueries(rows),
    pages: aggregatePages(rows),
    queryPagePairs: aggregateQueryPagePairs(rows),
  };
}
