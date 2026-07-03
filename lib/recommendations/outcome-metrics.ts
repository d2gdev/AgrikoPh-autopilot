// Pure, DB-free helpers for the outcome feedback loop (jobs/check-outcomes.ts).
// Kept separate from the job handler so the entity-finder and verdict math can
// be unit tested against synthetic snapshot payloads without touching prisma.

export type MetricSnapshot = {
  spend?: number;
  roas?: number;
  ctr?: number;
  cpa?: number;
  conversions?: number;
};

export type Verdict = "improved" | "worsened" | "neutral" | "insufficient_data";

export interface DeltaEntry {
  before: number;
  after: number;
  deltaPercent: number | null;
}

export interface OutcomeResult {
  verdict: Verdict;
  metricsBefore: MetricSnapshot;
  metricsAfter: MetricSnapshot;
  deltas: Record<string, DeltaEntry>;
  primaryMetric?: string;
}

// Order in which we pick the primary metric: ROAS if present else CPA else CTR.
const PRIMARY_METRIC_ORDER: (keyof MetricSnapshot)[] = ["roas", "cpa", "ctr"];
// For CPA, lower is better; everything else in PRIMARY_METRIC_ORDER is "higher is better".
const LOWER_IS_BETTER: ReadonlySet<keyof MetricSnapshot> = new Set(["cpa"]);
const IMPROVEMENT_THRESHOLD_PERCENT = 5;

const ENTITY_ARRAYS_BY_TYPE: Record<string, string[]> = {
  campaign: ["campaigns"],
  ad_set: ["adSets", "adGroups"],
  ad: ["ads"],
  keyword: ["keywords"],
};
const ALL_ENTITY_ARRAYS = ["campaigns", "adSets", "adGroups", "ads", "keywords"];

// Meta's `insights` rows carry per-entity spend/ctr/conversions keyed by one of
// these id fields (level=ad rows carry all three).
const INSIGHT_ID_FIELDS_BY_TYPE: Record<string, string[]> = {
  campaign: ["campaign_id"],
  ad_set: ["adset_id"],
  ad: ["ad_id"],
};
const ALL_INSIGHT_ID_FIELDS = ["campaign_id", "adset_id", "ad_id"];

const CONVERSION_ACTION_TYPES = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function toNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function findEntity(
  payload: Record<string, unknown>,
  targetEntityType: string,
  targetEntityId: string,
): Record<string, unknown> | undefined {
  const arrays = ENTITY_ARRAYS_BY_TYPE[targetEntityType] ?? ALL_ENTITY_ARRAYS;
  for (const key of arrays) {
    const arr = payload[key];
    if (!Array.isArray(arr)) continue;
    const match = arr.find(
      (item) =>
        item != null &&
        typeof item === "object" &&
        (item as Record<string, unknown>).id != null &&
        String((item as Record<string, unknown>).id) === String(targetEntityId),
    );
    if (match) return match as Record<string, unknown>;
  }
  return undefined;
}

function aggregateInsights(
  payload: Record<string, unknown>,
  targetEntityType: string,
  targetEntityId: string,
): { spend: number; ctr?: number; conversions: number } | undefined {
  const insights = payload.insights;
  if (!Array.isArray(insights)) return undefined;

  const idFields = INSIGHT_ID_FIELDS_BY_TYPE[targetEntityType] ?? ALL_INSIGHT_ID_FIELDS;
  let spend = 0;
  let clicks = 0;
  let impressions = 0;
  let conversions = 0;
  let matched = false;

  for (const row of insights) {
    if (row == null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const isMatch = idFields.some((f) => r[f] != null && String(r[f]) === String(targetEntityId));
    if (!isMatch) continue;
    matched = true;
    spend += toNumber(r.spend) ?? 0;
    clicks += toNumber(r.clicks) ?? 0;
    impressions += toNumber(r.impressions) ?? 0;
    const actions = Array.isArray(r.actions) ? r.actions : [];
    for (const action of actions) {
      if (action == null || typeof action !== "object") continue;
      const a = action as Record<string, unknown>;
      if (typeof a.action_type === "string" && CONVERSION_ACTION_TYPES.has(a.action_type)) {
        conversions += toNumber(a.value) ?? 0;
      }
    }
  }

  if (!matched) return undefined;
  return { spend, ctr: impressions > 0 ? clicks / impressions : undefined, conversions };
}

/**
 * Tolerant lookup of a recommendation's target entity in a RawSnapshot
 * payload, returning whatever of {spend, roas, ctr, cpa, conversions} it can
 * find. Handles two shapes:
 *  - metrics inline directly on the campaign/adGroup/keyword object
 *  - meta: campaign/adSet/ad objects carry no metrics; metrics live in a
 *    separate `insights` array keyed by campaign_id/adset_id/ad_id
 * Missing arrays/keys/entities never throw — returns undefined when nothing
 * usable was found.
 */
export function findEntityMetrics(
  payload: unknown,
  targetEntityType: string,
  targetEntityId: string | null | undefined,
): MetricSnapshot | undefined {
  if (!payload || typeof payload !== "object" || !targetEntityId) return undefined;
  const p = payload as Record<string, unknown>;

  const entity = findEntity(p, targetEntityType, targetEntityId);
  const insightAgg = aggregateInsights(p, targetEntityType, targetEntityId);
  if (!entity && !insightAgg) return undefined;

  const metrics: MetricSnapshot = {};

  if (entity) {
    const spend = toNumber(entity.spend);
    if (spend != null) metrics.spend = spend;
    const roas = toNumber(entity.roas);
    if (roas != null) metrics.roas = roas;
    const ctr = toNumber(entity.ctr);
    if (ctr != null) metrics.ctr = ctr;
    const cpa = toNumber(entity.costPerConversion ?? entity.cpa);
    if (cpa != null) metrics.cpa = cpa;
    const conversions = toNumber(entity.conversions);
    if (conversions != null) metrics.conversions = conversions;
  }

  if (insightAgg) {
    if (metrics.spend == null) metrics.spend = insightAgg.spend;
    if (metrics.ctr == null && insightAgg.ctr != null) metrics.ctr = insightAgg.ctr;
    if (metrics.conversions == null) metrics.conversions = insightAgg.conversions;
    if (metrics.cpa == null && metrics.conversions && metrics.conversions > 0 && metrics.spend != null) {
      metrics.cpa = metrics.spend / metrics.conversions;
    }
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function computeDeltas(before: MetricSnapshot, after: MetricSnapshot): Record<string, DeltaEntry> {
  const deltas: Record<string, DeltaEntry> = {};
  const keys = new Set<keyof MetricSnapshot>([
    ...(Object.keys(before) as (keyof MetricSnapshot)[]),
    ...(Object.keys(after) as (keyof MetricSnapshot)[]),
  ]);
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (b == null || a == null) continue;
    deltas[k] = { before: b, after: a, deltaPercent: b === 0 ? null : ((a - b) / Math.abs(b)) * 100 };
  }
  return deltas;
}

/**
 * Verdict rules: primary metric is ROAS if present on both sides, else CPA,
 * else CTR. >5% better (direction-aware for CPA) = improved, >5% worse =
 * worsened, else neutral. Missing either side, or no shared primary metric,
 * or a zero baseline (would divide by zero) = insufficient_data.
 */
export function computeOutcome(before: MetricSnapshot | undefined, after: MetricSnapshot | undefined): OutcomeResult {
  const metricsBefore = before ?? {};
  const metricsAfter = after ?? {};
  const deltas = computeDeltas(metricsBefore, metricsAfter);

  if (!before || !after) {
    return { verdict: "insufficient_data", metricsBefore, metricsAfter, deltas };
  }

  const primaryMetric = PRIMARY_METRIC_ORDER.find((k) => before[k] != null && after[k] != null);
  if (!primaryMetric) {
    return { verdict: "insufficient_data", metricsBefore, metricsAfter, deltas };
  }

  const beforeVal = before[primaryMetric]!;
  const afterVal = after[primaryMetric]!;
  if (beforeVal === 0) {
    return { verdict: "insufficient_data", metricsBefore, metricsAfter, deltas, primaryMetric };
  }

  const rawDeltaPercent = ((afterVal - beforeVal) / Math.abs(beforeVal)) * 100;
  const effectiveDelta = LOWER_IS_BETTER.has(primaryMetric) ? -rawDeltaPercent : rawDeltaPercent;

  let verdict: Verdict;
  if (effectiveDelta > IMPROVEMENT_THRESHOLD_PERCENT) verdict = "improved";
  else if (effectiveDelta < -IMPROVEMENT_THRESHOLD_PERCENT) verdict = "worsened";
  else verdict = "neutral";

  return { verdict, metricsBefore, metricsAfter, deltas, primaryMetric };
}
