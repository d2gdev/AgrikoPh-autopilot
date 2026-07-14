import type { GscPageMetrics } from "@/lib/connectors/gsc";

export type TopicalMapSeoOutcome = {
  kind: "topical_map_url_gsc";
  verdict: "improved" | "worsened" | "neutral" | "insufficient_data";
  reason?: "missing_receipt_url" | "before_window_empty" | "after_window_empty" | "gsc_unavailable";
  targetUrl: string;
  windowDays: 7;
  beforeWindow: { startDate: string; endDate: string };
  afterWindow: { startDate: string; endDate: string };
  metricsBefore: GscPageMetrics | null;
  metricsAfter: GscPageMetrics | null;
  deltas: Record<string, { before: number; after: number; deltaPercent: number | null }>;
  checkedAt: string;
  storeRevenue: { before: number | null; after: number | null; windowDays: number };
};

type MetricEvaluation = Pick<TopicalMapSeoOutcome, "verdict" | "reason" | "deltas">;

const DAY_MS = 24 * 60 * 60 * 1_000;
const THRESHOLD_PERCENT = 5;

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function topicalMapGscWindows(executedAt: Date) {
  const executionDay = Date.UTC(
    executedAt.getUTCFullYear(),
    executedAt.getUTCMonth(),
    executedAt.getUTCDate(),
  );
  return {
    before: {
      startDate: dateOnly(new Date(executionDay - 7 * DAY_MS)),
      endDate: dateOnly(new Date(executionDay - DAY_MS)),
    },
    after: {
      startDate: dateOnly(new Date(executionDay + DAY_MS)),
      endDate: dateOnly(new Date(executionDay + 7 * DAY_MS)),
    },
  };
}

function delta(before: number, after: number) {
  return {
    before,
    after,
    deltaPercent: before === 0 ? null : ((after - before) / before) * 100,
  };
}

export function evaluateTopicalMapGscMetrics(
  before: GscPageMetrics | null,
  after: GscPageMetrics | null,
): MetricEvaluation {
  if (!before) return { verdict: "insufficient_data", reason: "before_window_empty", deltas: {} };
  if (!after) return { verdict: "insufficient_data", reason: "after_window_empty", deltas: {} };

  const deltas: MetricEvaluation["deltas"] = {
    clicks: delta(before.clicks, after.clicks),
    impressions: delta(before.impressions, after.impressions),
  };
  if (before.ctr != null && after.ctr != null) deltas.ctr = delta(before.ctr, after.ctr);
  if (before.avgPosition != null && after.avgPosition != null) {
    deltas.avgPosition = delta(before.avgPosition, after.avgPosition);
  }

  const primary = before.clicks !== 0
    ? deltas.clicks
    : before.impressions !== 0
      ? deltas.impressions
      : before.avgPosition != null && before.avgPosition !== 0
        ? deltas.avgPosition
        : undefined;
  if (!primary?.deltaPercent) {
    return primary?.deltaPercent === 0
      ? { verdict: "neutral", deltas }
      : { verdict: "insufficient_data", deltas };
  }

  const change = primary === deltas.avgPosition ? -primary.deltaPercent : primary.deltaPercent;
  const verdict = change > THRESHOLD_PERCENT
    ? "improved"
    : change < -THRESHOLD_PERCENT
      ? "worsened"
      : "neutral";
  return { verdict, deltas };
}
