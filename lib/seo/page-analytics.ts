import { Prisma } from "@prisma/client";
import { normalizePagePath } from "@/lib/seo/page-health";
import { parseNum, parsePercent } from "@/lib/seo/types";

export interface PageAnalyticsInput {
  page: string;
  sessions: number;
  totalUsers: number;
  conversions: number;
  bounceRate: number | null;
  conversionRate: number | null;
  rawPayload: Prisma.InputJsonValue;
}

type Ga4PageLike = {
  page?: string | null;
  sessions?: number | string | null;
  bounceRate?: string | number | null;
  conversionRate?: string | number | null;
  totalUsers?: number | string | null;
  conversions?: number | string | null;
};

export function toPageAnalyticsInput(row: Ga4PageLike): PageAnalyticsInput | null {
  const page = normalizePagePath(row.page);
  if (!page) return null;

  return {
    page,
    sessions: Math.round(parseNum(row.sessions)),
    totalUsers: Math.round(parseNum(row.totalUsers)),
    conversions: Math.round(parseNum(row.conversions)),
    bounceRate: row.bounceRate == null ? null : parsePercent(row.bounceRate),
    conversionRate: row.conversionRate == null ? null : parsePercent(row.conversionRate),
    rawPayload: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
  };
}

export function articleHandleFromPath(path: string | null | undefined): string {
  const normalized = normalizePagePath(path);
  const segments = normalized.split("/").filter(Boolean);
  return segments[0] === "blogs" && segments.length >= 3 ? segments[2] ?? "" : "";
}

export function buildArticleSessionMap(
  rows: Array<{ page: string; sessions: number }>,
): Record<string, number> {
  const trafficMap: Record<string, number> = {};
  for (const row of rows) {
    const handle = articleHandleFromPath(row.page);
    if (!handle) continue;
    trafficMap[handle] = (trafficMap[handle] ?? 0) + (row.sessions ?? 0);
  }
  return trafficMap;
}
