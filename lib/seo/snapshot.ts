import { prisma } from "@/lib/db";
import type { GscQueryRow, Ga4PageRow } from "@/lib/seo/types";

export interface SnapshotRecord {
  id: string;
  fetchedAt: Date;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  payload: Record<string, unknown>;
}

/** Latest snapshot for a given source ("gsc" | "ga4" | "gsc_pages" | "gsc_query_page" | "seo_analysis"). */
export async function getLatestSnapshot(source: string): Promise<SnapshotRecord | null> {
  const snap = await prisma.rawSnapshot.findFirst({
    where: { source },
    orderBy: [{ dateRangeEnd: "desc" }, { fetchedAt: "desc" }],
  });
  if (!snap) return null;
  return {
    id: snap.id,
    fetchedAt: snap.fetchedAt,
    dateRangeStart: snap.dateRangeStart,
    dateRangeEnd: snap.dateRangeEnd,
    payload: (snap.payload as Record<string, unknown>) ?? {},
  };
}

/**
 * A1: The "previous period" snapshot for true period-over-period comparison:
 * the snapshot whose `dateRangeEnd` immediately precedes (is <=) the latest
 * snapshot's `dateRangeStart` — i.e. the adjacent prior window, matched by
 * date range, NOT by `fetchedAt`. This guarantees non-overlapping, reproducible
 * deltas regardless of fetch cadence.
 *
 * When no adjacent prior period exists, returns `null` (no comparison
 * available). The previous oldest-snapshot fallback is intentionally removed:
 * comparing against an arbitrarily old, possibly-overlapping window produced
 * wrong, non-reproducible deltas.
 *
 * Return type is `SnapshotRecord | null` (unchanged) to keep call sites stable.
 */
export async function getComparisonSnapshot(
  source: string,
  latest: SnapshotRecord,
): Promise<SnapshotRecord | null> {
  // Pick the snapshot whose window ends at or before the latest window starts,
  // preferring the one ending closest to (immediately before) latest's start.
  const prior = await prisma.rawSnapshot.findFirst({
    where: {
      source,
      id: { not: latest.id },
      dateRangeEnd: { lte: latest.dateRangeStart },
    },
    orderBy: { dateRangeEnd: "desc" },
  });
  if (!prior) return null;
  return {
    id: prior.id,
    fetchedAt: prior.fetchedAt,
    dateRangeStart: prior.dateRangeStart,
    dateRangeEnd: prior.dateRangeEnd,
    payload: (prior.payload as Record<string, unknown>) ?? {},
  };
}

/** Full history of snapshots for a source, newest first. */
export async function getSnapshotHistory(source: string, limit = 12): Promise<SnapshotRecord[]> {
  const snaps = await prisma.rawSnapshot.findMany({
    where: { source },
    orderBy: { fetchedAt: "desc" },
    take: limit,
  });
  return snaps.map((s) => ({
    id: s.id,
    fetchedAt: s.fetchedAt,
    dateRangeStart: s.dateRangeStart,
    dateRangeEnd: s.dateRangeEnd,
    payload: (s.payload as Record<string, unknown>) ?? {},
  }));
}

export function getQueries(snap: SnapshotRecord | null): GscQueryRow[] {
  const q = snap?.payload?.topQueries;
  return Array.isArray(q) ? (q as GscQueryRow[]) : [];
}

export function getPages(snap: SnapshotRecord | null): Ga4PageRow[] {
  const p = snap?.payload?.topPages;
  return Array.isArray(p) ? (p as Ga4PageRow[]) : [];
}
