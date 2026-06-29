export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAppAuth } from "@/lib/auth";
import { buildReport, addInsightRow, derive, emptyMetrics } from "@/lib/ad-pilot/report";

const TREND_LIMIT = 30;

type MetaSnapshot = {
  fetchedAt: Date;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  payload: unknown;
};

function periodLabel(start: Date, end: Date): string {
  const startLabel = start.toISOString().slice(0, 10);
  const endLabel = end.toISOString().slice(0, 10);
  return startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
}

function period(snapshot: MetaSnapshot) {
  return {
    start: snapshot.dateRangeStart.toISOString(),
    end: snapshot.dateRangeEnd.toISOString(),
    label: periodLabel(snapshot.dateRangeStart, snapshot.dateRangeEnd),
  };
}

function durationMs(snapshot: MetaSnapshot): number {
  return snapshot.dateRangeEnd.getTime() - snapshot.dateRangeStart.getTime();
}

function equivalentPriorSnapshot(current: MetaSnapshot, snapshots: MetaSnapshot[]): MetaSnapshot | null {
  return snapshots.slice(1).find((candidate) =>
    current.dateRangeStart > candidate.dateRangeStart &&
    Math.abs(durationMs(current) - durationMs(candidate)) < 1000
  ) ?? null;
}

function spendFromSnapshot(snapshot: MetaSnapshot): number {
  const p = snapshot.payload as Record<string, unknown>;
  const insights = (p.insights as Array<Record<string, unknown>>) ?? [];
  const m = emptyMetrics();
  for (const row of insights) addInsightRow(m, row);
  return m.spend;
}

export async function GET(req: NextRequest) {
  const authError = await requireAppAuth(req);
  if (authError) return authError;

  // Pull recent snapshots: newest drives the detailed report, the rest feed the trend.
  const snapshots = await prisma.rawSnapshot.findMany({
    where: { source: "meta" },
    orderBy: { fetchedAt: "desc" },
    take: TREND_LIMIT,
  });

  if (snapshots.length === 0) {
    return NextResponse.json({ report: null, trend: [], message: "No data yet — run the analyzer first" });
  }

  const latest = snapshots[0]!;
  const payload = latest.payload as Record<string, unknown>;
  const comparablePrevious = equivalentPriorSnapshot(latest, snapshots);
  const currentSpend = spendFromSnapshot(latest);
  const previousSpend = comparablePrevious ? spendFromSnapshot(comparablePrevious) : 0;
  const delta = comparablePrevious ? currentSpend - previousSpend : 0;
  const comparison = comparablePrevious
    ? {
        comparable: true,
        current: currentSpend,
        previous: previousSpend,
        delta,
        deltaPct: previousSpend > 0 ? (delta / previousSpend) * 100 : null,
        currentPeriod: period(latest),
        previousPeriod: period(comparablePrevious),
        label: `${periodLabel(latest.dateRangeStart, latest.dateRangeEnd)} vs ${periodLabel(comparablePrevious.dateRangeStart, comparablePrevious.dateRangeEnd)}`,
      }
    : {
        comparable: false,
        current: currentSpend,
        previous: 0,
        delta: 0,
        deltaPct: null,
        currentPeriod: period(latest),
        previousPeriod: null,
        label: null,
      };

  // Pending recommendation counts per campaign for the latest snapshot.
  const campaignIds = ((payload.campaigns as Array<{ id: string }>) ?? []).map((c) => c.id);
  const recCounts = campaignIds.length
    ? await prisma.recommendation.groupBy({
        by: ["targetEntityId"],
        where: { targetEntityId: { in: campaignIds }, status: "pending" },
        _count: { id: true },
      })
    : [];
  const recCountByCampaign = Object.fromEntries(recCounts.map((r) => [r.targetEntityId, r._count.id]));

  const report = buildReport(payload, recCountByCampaign);

  // Build a chronological trend series (oldest → newest) of account-level KPIs.
  const trend = [...snapshots]
    .reverse()
    .map((snap) => {
      const p = snap.payload as Record<string, unknown>;
      const insights = (p.insights as Array<Record<string, unknown>>) ?? [];
      const m = emptyMetrics();
      for (const row of insights) addInsightRow(m, row);
      const d = derive(m);
      return {
        date: snap.fetchedAt,
        period: period(snap),
        spend: d.spend,
        revenue: d.revenue,
        conversions: d.conversions,
        roas: d.roas,
      };
    });

  return NextResponse.json({ report, trend, fetchedAt: latest.fetchedAt, period: period(latest), comparison });
}
