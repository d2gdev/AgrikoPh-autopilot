import type { GscQueryRow, SnapshotTrendPoint } from "@/lib/seo/types";
import { parseNum } from "@/lib/seo/types";

// B5 — snapshot history trend aggregator.
//
// Accepts whatever `getSnapshotHistory` (lib/seo/snapshot.ts) returns. We only
// depend on the fields we use, so a structural subset is declared here rather
// than importing the concrete type — keeps this pure and decoupled.
export interface SnapshotTrendInput {
  dateRangeEnd: Date | string;
  payload: Record<string, unknown>;
}

/**
 * Local copy of trends.ts `totals` (intentionally NOT importing — trends.ts
 * keeps it private and must not be edited). Impression-weighted avg position.
 */
export function computeSnapshotTotals(rows: GscQueryRow[]): {
  clicks: number;
  impressions: number;
  avgPosition: number;
  ctr: number;
} {
  let clicks = 0;
  let impressions = 0;
  let weightedPos = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weightedPos += parseNum(r.position) * r.impressions;
  }
  return {
    clicks,
    impressions,
    avgPosition: impressions > 0 ? weightedPos / impressions : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

function getQueries(payload: Record<string, unknown>): GscQueryRow[] {
  const q = payload?.topQueries;
  return Array.isArray(q) ? (q as GscQueryRow[]) : [];
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/**
 * Map each snapshot's stored `topQueries` payload through totals to emit a
 * time series keyed by dateRangeEnd, sorted oldest→newest.
 */
export function computeSnapshotTrend(
  snapshots: SnapshotTrendInput[],
): SnapshotTrendPoint[] {
  const points: SnapshotTrendPoint[] = snapshots.map((snap) => {
    const t = computeSnapshotTotals(getQueries(snap.payload));
    return {
      date: toIso(snap.dateRangeEnd),
      clicks: t.clicks,
      impressions: t.impressions,
      avgPosition: t.avgPosition,
      ctr: t.ctr,
    };
  });

  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}
